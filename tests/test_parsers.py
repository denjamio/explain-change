"""Unit tests for the deterministic core. Run: python3 -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import explainchange as ec  # noqa: E402


def make(components, layers=None, rules=None):
    raw = {"layers": layers or [{"id": layer} for layer in sorted({c["layer"] for c in components})],
           "components": components, "rules": rules or {}}
    cfg, errs = ec.normalize_config(raw, inferred=False)
    assert not errs, errs
    return cfg, ec.Mapper(cfg)


def edges_for(files: dict, components, tsconfigs=None):
    cfg, mapper = make(components)
    extracted = {p: ec.extract(p, t) for p, t in files.items()}
    index = ec.SideIndex(set(files), mapper, tsconfigs or [], extracted)
    edges, unresolved = ec.build_edges(extracted, index, mapper)
    return {f"{a}->{b}": e["count"] for (a, b), e in edges.items()}, unresolved


class GlobTests(unittest.TestCase):
    def test_globs(self):
        self.assertTrue(ec.matches_any("app/models/billing/invoice.rb", ["app/models/**"]))
        self.assertTrue(ec.matches_any("app/models/order.rb", ["app/models"]))
        self.assertFalse(ec.matches_any("app/models_legacy/order.rb", ["app/models"]))
        self.assertTrue(ec.matches_any("billing/tests/test_invoice.py", ["**/test_*.py"]))
        self.assertTrue(ec.matches_any("test_invoice.py", ["**/test_*.py"]))
        self.assertFalse(ec.matches_any("app/models/billing/invoice.rb", ["app/*.rb"]))


class DjangoTests(unittest.TestCase):
    def test_absolute_relative_and_from_imports(self):
        files = {
            "backend/manage.py": "",
            "backend/orders/views.py": "from .models import Order\nfrom billing.services import charge\nimport django.db\n",
            "backend/orders/models.py": "from django.db import models\n",
            "backend/billing/__init__.py": "",
            "backend/billing/services.py": "def charge(): pass\n",
        }
        comps = [{"id": "orders", "layer": "app", "paths": ["backend/orders/**"]},
                 {"id": "billing", "layer": "app", "paths": ["backend/billing/**"]}]
        edges, unresolved = edges_for(files, comps)
        self.assertEqual(edges, {"orders->billing": 1})
        self.assertEqual(unresolved, 0)


class RailsTests(unittest.TestCase):
    def test_zeitwerk_constants_and_require_relative(self):
        files = {
            "app/controllers/orders_controller.rb": (
                "class OrdersController < ApplicationController\n"
                "  def create\n    Billing::Charge.call(order)  # comment Payments::Ignored\n"
                "    Order.create!(params)\n    puts 'Fake::Constant'\n  end\nend\n"),
            "app/controllers/application_controller.rb": "class ApplicationController; end\n",
            "app/services/billing/charge.rb": "module Billing\n  class Charge\n    def self.call(o) = Order.find(o)\n  end\nend\n",
            "app/models/order.rb": "class Order < ApplicationRecord\nend\n",
            "lib/tasks/helper.rb": "require_relative '../../app/models/order'\n",
        }
        comps = [{"id": "web", "layer": "entry", "paths": ["app/controllers/**"]},
                 {"id": "billing", "layer": "app", "paths": ["app/services/billing/**"]},
                 {"id": "models", "layer": "domain", "paths": ["app/models/**"]},
                 {"id": "tasks", "layer": "app", "paths": ["lib/**"]}]
        edges, _ = edges_for(files, comps)
        self.assertEqual(edges, {"web->billing": 1, "web->models": 1, "billing->models": 1, "tasks->models": 1})

    def test_lines_starting_with_require_are_still_read(self):
        files = {"app/models/a.rb": "class A\n  def x\n    required = Billing::Plan.find(1)\n  end\nend\n",
                 "app/services/billing/plan.rb": "module Billing\n  class Plan\n  end\nend\n"}
        comps = [{"id": "models", "layer": "domain", "paths": ["app/models/**"]},
                 {"id": "billing", "layer": "app", "paths": ["app/services/billing/**"]}]
        edges, _ = edges_for(files, comps)
        self.assertEqual(edges, {"models->billing": 1})

    def test_constant_override(self):
        files = {"app/models/a.rb": "class A\n  Stripe::Charge.create\nend\n", "lib/stripe_client.rb": ""}
        comps = [{"id": "models", "layer": "domain", "paths": ["app/models/**"]},
                 {"id": "stripe", "layer": "infra", "paths": ["lib/stripe_client.rb"], "constants": ["Stripe::*"]}]
        edges, _ = edges_for(files, comps)
        self.assertEqual(edges, {"models->stripe": 1})


class RailsDeepTests(unittest.TestCase):
    COMPS = [{"id": "models", "layer": "domain", "paths": ["app/models/**"]},
             {"id": "billing", "layer": "domain", "paths": ["app/models/billing/**"]},
             {"id": "api", "layer": "entry", "paths": ["app/controllers/**"]},
             {"id": "svc", "layer": "app", "paths": ["app/services/**"]}]

    def test_sibling_classes_do_not_nest(self):
        # Before: nesting leaked across siblings, so Invoice inside C resolved to A::B::Invoice.
        files = {
            "app/services/a.rb": "module A\n  class B\n    def x; end\n  end\n\n  class C\n    def y = Invoice.new\n  end\nend\n",
            "app/models/a/b/invoice.rb": "module A\n  class B\n    class Invoice; end\n  end\nend\n",
            "app/models/billing/invoice.rb": "class Billing::Invoice; end\n",
            "app/models/invoice.rb": "class Invoice; end\n",
        }
        edges, _ = edges_for(files, self.COMPS)
        self.assertEqual(edges, {"svc->models": 1})
        ref = [r for r in ec.extract("app/services/a.rb", files["app/services/a.rb"])["refs"] if r[1] == "Invoice"][0]
        self.assertEqual(ref[3], ("A", "A::C"))

    def test_associations(self):
        files = {
            "app/models/order.rb": ("class Order < ApplicationRecord\n  has_many :line_items\n  belongs_to :customer\n"
                                    "  has_many :invoices, class_name: \"Billing::Invoice\"\n"
                                    "  belongs_to :owner, polymorphic: true\n  has_many :taxes, through: :line_items\nend\n"),
            "app/models/line_item.rb": "class LineItem < ApplicationRecord; end\n",
            "app/models/customer.rb": "class Customer < ApplicationRecord; end\n",
            "app/models/billing/invoice.rb": "class Billing::Invoice < ApplicationRecord; end\n",
        }
        consts = {r[1] for r in ec.extract("app/models/order.rb", files["app/models/order.rb"])["refs"]}
        self.assertTrue({"LineItem", "Customer", "Billing::Invoice"} <= consts)
        self.assertNotIn("Owner", consts)
        self.assertNotIn("Tax", consts)
        edges, _ = edges_for(files, self.COMPS)
        self.assertEqual(edges, {"models->billing": 1})

    def test_zeitwerk_acronyms(self):
        files = {
            "config/initializers/inflections.rb": "ActiveSupport::Inflector.inflections(:en) do |inflect|\n  inflect.acronym \"API\"\nend\n",
            "app/controllers/api/v1/orders_controller.rb": "class API::V1::OrdersController\n  def index = Billing::Invoice.all\nend\n",
            "app/services/sync.rb": "class Sync\n  def call = API::V1::OrdersController\nend\n",
            "app/models/billing/invoice.rb": "",
        }
        edges, _ = edges_for(files, self.COMPS)
        self.assertEqual(edges, {"api->billing": 1, "svc->api": 1})

    def test_interpolated_strings_are_not_constants(self):
        refs = ec.extract("app/jobs/x.rb", 'class X\n  def y\n    log "Family failed: #{e.message}" # Order\n    Invoice.new\n  end\nend\n')["refs"]
        self.assertEqual({r[1] for r in refs}, {"Invoice"})

    def test_erb_only_ruby_blocks(self):
        text = '<h1>Account settings</h1>\n<%= render DS::Link.new(text: "Order now") %>\n<% if Current.user %>Family<% end %>'
        self.assertEqual({r[1] for r in ec.extract("app/views/a.html.erb", text)["refs"]}, {"DS::Link", "Current"})

    def test_singularize(self):
        for plural, single in [("line_items", "line_item"), ("categories", "category"), ("addresses", "address"),
                               ("people", "person"), ("statuses", "status"), ("boxes", "box"), ("class", "class")]:
            self.assertEqual(ec.singularize(plural), single)


class DjangoDeepTests(unittest.TestCase):
    def test_string_relations_and_dotted_calls(self):
        files = {
            "manage.py": "",
            "apps/orders/apps.py": "class OrdersConfig(AppConfig):\n    name = 'apps.orders'\n",
            "apps/orders/models.py": ("from django.db import models\n\nclass Order(models.Model):\n"
                                      "    customer = models.ForeignKey('crm.Customer', on_delete=models.CASCADE)\n"
                                      "    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)\n"
                                      "    parent = models.ForeignKey('self', on_delete=models.CASCADE)\n"),
            "apps/orders/tasks.py": "from django.apps import apps\nInvoice = apps.get_model('billing', 'Invoice')\n",
            "apps/customers/apps.py": "class C(AppConfig):\n    name = 'apps.customers'\n    label = 'crm'\n",
            "apps/customers/models.py": "",
            "apps/billing/apps.py": "", "apps/billing/models/__init__.py": "",
            "config/urls.py": "from django.urls import include, path\nurlpatterns = [path('o/', include('orders.urls'))]\n",
            "apps/orders/urls.py": "",
        }
        comps = [{"id": "orders", "layer": "apps", "paths": ["apps/orders/**"]},
                 {"id": "customers", "layer": "apps", "paths": ["apps/customers/**"]},
                 {"id": "billing", "layer": "apps", "paths": ["apps/billing/**"]},
                 {"id": "project", "layer": "entry", "paths": ["config/**"]}]
        edges, unresolved = edges_for(files, comps)
        self.assertEqual(edges, {"orders->customers": 1, "orders->billing": 1, "project->orders": 1})
        self.assertEqual(unresolved, 0)


class StructureTests(unittest.TestCase):
    def test_rails_layout(self):
        files = ["Gemfile", "config/application.rb", "config/routes.rb", "app/controllers/orders_controller.rb",
                 "app/models/order.rb", "app/services/checkout.rb", "app/mailers/order_mailer.rb",
                 "app/views/orders/show.html.erb", "app/views/settings/show.html.erb", "app/helpers/orders_helper.rb",
                 "app/javascript/controllers/map_controller.js", "lib/money.rb", "spec/models/order_spec.rb"]
        st = ec.detect_structure(files)
        self.assertEqual(st["kind"], "rails")
        got = {c["id"]: (c["layer"], c["paths"]) for c in st["components"]}
        self.assertEqual({k: v[0] for k, v in got.items()},
                         {"ui": "web", "controllers": "web", "services": "application", "models": "domain",
                          "mailers": "infrastructure", "lib": "infrastructure"})
        # Presentation is one component; routes belong to the controllers.
        self.assertEqual(got["ui"][1], ["app/views/**", "app/helpers/**", "app/javascript/**"])
        self.assertEqual(got["controllers"][1], ["app/controllers/**", "config/routes.rb"])

    def test_rails_namespace_is_named_after_the_concept(self):
        files = ["Gemfile", "config/application.rb", "app/models/family.rb"] + \
                [f"app/models/family/part_{i}.rb" for i in range(8)] + [f"app/models/thing_{i}.rb" for i in range(25)]
        comps = {c["id"]: c for c in ec.detect_structure(files)["components"]}
        self.assertEqual(comps["models-family"]["name"], "Family")
        self.assertEqual(comps["models-family"]["paths"], ["app/models/family.rb", "app/models/family/**"])
        _, mapper = make([{k: c[k] for k in ("id", "layer", "paths")} for c in comps.values()])
        self.assertEqual(mapper.component("app/models/family.rb"), "models-family")

    def test_django_layout_with_project_package_and_nested_apps(self):
        files = ["manage.py", "hc/settings.py", "hc/urls.py", "hc/accounts/models.py", "hc/api/views.py",
                 "hc/lib/emails.py", "hc/integrations/__init__.py"] + \
                [f"hc/integrations/{n}/models.py" for n in ("a", "b", "c", "d", "e", "f")]
        st = ec.detect_structure(files)
        self.assertEqual(st["kind"], "django")
        got = {c["id"]: (c["layer"], c["paths"]) for c in st["components"]}
        self.assertEqual(got["project"], ("web", ["hc/*.py", "hc/settings/**"]))
        self.assertEqual(got["api"][0], "web")
        self.assertEqual(got["lib"][0], "shared")
        self.assertIn("integrations", got)
        self.assertNotIn("a", got)

    def test_most_specific_path_wins(self):
        cfg, mapper = make([{"id": "models", "layer": "d", "paths": ["app/models/**"]},
                            {"id": "billing", "layer": "d", "paths": ["app/models/billing/**"]}])
        self.assertEqual(mapper.component("app/models/billing/invoice.rb"), "billing")
        self.assertEqual(mapper.component("app/models/order.rb"), "models")


class DiffAndRulesTests(unittest.TestCase):
    DIFF = """diff --git a/app/models/a.rb b/app/models/a.rb
index 1..2 100644
--- a/app/models/a.rb
+++ b/app/models/a.rb
@@ -1,3 +1,4 @@ class A
 line1
--- not a header, a removed line
+++ not a header, an added line
+added
 line3
diff --git a/old.py b/new.py
similarity index 90%
rename from old.py
rename to new.py
diff --git a/gone.rb b/gone.rb
deleted file mode 100644
--- a/gone.rb
+++ /dev/null
@@ -1 +0,0 @@
-x
"""

    def test_parse_diff(self):
        files = ec.parse_diff(self.DIFF)
        self.assertEqual([(f["path"], f["status"]) for f in files], [("app/models/a.rb", "M"), ("new.py", "R"), ("gone.rb", "D")])
        self.assertEqual((files[0]["add"], files[0]["del"]), (2, 1))
        self.assertEqual(files[1]["old_path"], "old.py")

    def test_rules(self):
        cfg, _ = make([{"id": "o", "layer": "domain", "paths": ["d/**"]}, {"id": "m", "layer": "infra", "paths": ["i/**"]}],
                      layers=[{"id": "domain"}, {"id": "infra"}], rules={"allow": ["infra -> domain"]})
        layer_of = {"o": "domain", "m": "infra"}
        self.assertIsNone(ec.rule_violation("m", "o", cfg, layer_of))
        self.assertEqual(ec.rule_violation("o", "m", cfg, layer_of), "not allowed: domain -> infra")

    def test_symbols(self):
        def hunk(lines):
            return [{"old_start": 1, "old_len": 1, "new_start": 1, "new_len": len(lines) - 1, "header": "", "lines": lines}]
        rb = {"path": "app/models/order.rb", "hunks": hunk([
            ["-", "class Order < ApplicationRecord"], ["+", "class Order < ActiveRecord::Base"], ["+", "  def refund!(amount)"]])}
        routes = {"path": "config/routes.rb", "hunks": hunk([["+", "  resources :refunds, only: :create"]])}
        urls = {"path": "billing/urls.py", "hunks": hunk([["+", '    path("invoices/<int:pk>/", views.detail),']])}
        got = {(s["kind"], s["name"], s["change"]) for f in (rb, routes, urls) for s in ec.extract_symbols(f)}
        self.assertEqual(got, {("class", "Order", "modified"), ("def", "refund!", "added"),
                               ("endpoint", "resources refunds", "added"), ("endpoint", "path invoices/<int:pk>/", "added")})


class EndpointScopeTests(unittest.TestCase):
    @staticmethod
    def symbols(path, line):
        f = {"path": path, "hunks": [{"old_start": 1, "new_start": 1, "lines": [["+", line]]}]}
        return {(s["kind"], s["name"]) for s in ec.extract_symbols(f)}

    def test_routes_only_in_route_files(self):
        self.assertEqual(self.symbols("config/routes.rb", "  delete :sessions"), {("endpoint", "delete sessions")})
        self.assertEqual(self.symbols("config/routes/admin.rb", "  get 'stats'"), {("endpoint", "get stats")})
        self.assertEqual(self.symbols("app/models/user.rb", "    delete user"), set())
        self.assertEqual(self.symbols("orders/urls.py", 'path("orders/", views.index),'), {("endpoint", "path orders/")})
        self.assertEqual(self.symbols("orders/api/urls/v1.py", 'path("v1/", api),'), {("endpoint", "path v1/")})
        self.assertEqual(self.symbols("orders/services.py", 'x = path("orders/", y)'), set())
        self.assertEqual(self.symbols("api/routers.py", 'router.register(r"orders", OrderViewSet)'),
                         {("endpoint", "register orders")})


class DiffPathTests(unittest.TestCase):
    def test_quoted_and_spaced_paths(self):
        self.assertEqual(ec.diff_path("b/moved space.py\t"), "b/moved space.py")
        self.assertEqual(ec.diff_path('"b/quo\\"te.py"'), 'b/quo"te.py')
        self.assertEqual(ec.diff_path('"a/tab\\there.py"'), "a/tab\there.py")
        self.assertEqual(ec.diff_path('"a/\\303\\261.py"'), "a/ñ.py")
        diff = ("diff --git a/with space.py b/moved space.py\nsimilarity index 50%\nrename from with space.py\n"
                "rename to moved space.py\n--- a/with space.py\t\n+++ b/moved space.py\t\n@@ -1 +1,2 @@\n x\n+y\n"
                'diff --git "a/tab\\there.py" "b/tab\\tmoved.py"\nsimilarity index 100%\n'
                'rename from "tab\\there.py"\nrename to "tab\\tmoved.py"\n'
                "diff --git a/same name.py b/same name.py\nold mode 100644\nnew mode 100755\n")
        got = [(f["path"], f["old_path"], f["status"]) for f in ec.parse_diff(diff)]
        self.assertEqual(got, [("moved space.py", "with space.py", "R"), ("tab\tmoved.py", "tab\there.py", "R"),
                               ("same name.py", None, "M")])


class ExcerptTests(unittest.TestCase):
    def test_prune_keeps_only_referenced_lines(self):
        lines = [[" ", "a"], ["-", "b"], ["+", "B"], [" ", "c"]] + [["+", f"x{i}"] for i in range(20)] + [[" ", "z"]]
        f = {"path": "app/models/order.rb", "status": "M",
             "hunks": [{"old_start": 10, "old_len": 4, "new_start": 10, "new_len": 24, "header": "class Order", "lines": lines}]}
        got = ec.prune_hunks(f, [(30, 31)])
        self.assertEqual(len(got), 1)
        self.assertEqual((got[0]["new_start"], got[0]["new_len"], got[0]["old_len"]), (30, 2, 0))
        self.assertEqual([t for t, _ in got[0]["lines"]], ["+", "+"])
        self.assertEqual(ec.prune_hunks(f, []), [])

    def test_ranges_come_from_story_and_evidence(self):
        ctx = {"edges": [], "openspec": None}
        ins = {"story": [{"code": "a.rb:5-6"}], "decisions": [{"evidence": "b.py:9"}, {}]}
        self.assertEqual(ec.excerpt_ranges(ctx, ins), {"a.rb": [(2, 9)], "b.py": [(6, 12)]})


class InsightValidationTests(unittest.TestCase):
    CTX = {"key": "k1", "stats": {"violations_new": 1},
           "config": {"components": [{"id": "a", "layer": "x"}, {"id": "b", "layer": "x"}], "layers": [{"id": "x"}]},
           "components": [{"id": "a", "status": "changed"}, {"id": "b", "status": "context"}],
           "edges": [{"from": "b", "to": "a", "status": "same"}], "deps": [["b", "a"]],
           "files": [{"path": "f.rb", "status": "M", "component": "a", "category": "code",
                      "hunks": [{"old_start": 10, "old_len": 3, "new_start": 10, "new_len": 5, "lines": []}]}]}

    def valid(self, **over):
        ins = {"key": "k1", "tldr": "t", "intent": "i",
               "changes": [{"id": "a", "summary": "s"}],
               "story": [{"heading": "a now does x", "body": "b", "focus": ["a"]},
                         {"heading": "overview", "body": "b", "stage": "architecture", "code": "f.rb:11"}]}
        ins.update(over)
        return ins

    def test_valid(self):
        self.assertEqual(ec.validate_insight(self.valid(), self.CTX), [])

    def test_version_and_lang(self):
        ctx = {**self.CTX, "config": {**self.CTX["config"], "lang": "es"}}
        self.assertEqual(ec.validate_insight(self.valid(version=1, lang="es"), ctx), [])
        errs = "\n".join(ec.validate_insight(self.valid(version=7, lang="en"), ctx))
        self.assertIn("version: '7' must be 1", errs)
        self.assertIn("lang: 'en' must be 'es'", errs)

    def test_non_object_items_are_errors_with_exact_indices(self):
        ins = self.valid(changes=["a", {"id": "a", "summary": "s"}], decisions=[{"title": "t", "why": "w"}, 3],
                         flows=[{"id": "f", "title": "t", "steps": ["x", {"from": "a", "to": "b", "msg": "m",
                                                                         "status": "new"}]}])
        errs = ec.validate_insight(ins, self.CTX)
        for needle in ("changes[0]: must be an object", "decisions[1]: must be an object",
                       "flows[0].steps[0]: must be an object"):
            self.assertIn(needle, errs)
        self.assertFalse(any(e.startswith("changes[1]") for e in errs), errs)

    def test_stale_key_only(self):
        errs = ec.validate_insight(self.valid(key="k0"), self.CTX)
        self.assertTrue(any(e.startswith("key:") for e in errs))

    def test_errors_are_precise(self):
        ins = self.valid(tldr="x" * 300, principles=[],
                         flows=[{"id": "Bad Id", "title": "t", "steps": [{"from": "a", "to": "zz", "msg": "m", "status": "new"}]}],
                         decisions=[{"title": "t", "why": "w", "evidence": "f.rb:50-60"}])
        errs = "\n".join(ec.validate_insight(ins, self.CTX))
        for needle in ("tldr: 300 chars", "principles: unknown field",
                       "flows[0].id", "steps[0].to: 'zz' is not a component of this change (use: a, b)",
                       "50-60 is outside the hunks of f.rb (10-14)"):
            self.assertIn(needle, errs)

    def test_every_changed_component_is_described(self):
        errs = "\n".join(ec.validate_insight(self.valid(changes=[{"id": "b", "summary": "s"}]), self.CTX))
        self.assertIn("changes[0].id: 'b' is not a changed component (use: a)", errs)
        self.assertIn("missing a one-line summary for a", errs)

    def test_flow_steps_are_verified_against_edges(self):
        ins = self.valid(flows=[{"id": "f", "title": "t", "steps": [
            {"from": "a", "to": "b", "msg": "m", "status": "same"}, {"from": "a", "to": "a", "msg": "m", "status": "same"}]}])
        self.assertEqual(ec.validate_insight(ins, self.CTX), [])
        steps = ec.normalize_insight(ins, self.CTX)["flows"][0]["steps"]
        self.assertEqual([s["verified"] for s in steps], [True, True])
        ctx = {**self.CTX, "deps": []}
        self.assertFalse(ec.normalize_insight(ins, ctx)["flows"][0]["steps"][0]["verified"])

    def test_story_and_hero(self):
        ins = self.valid(story=[{"heading": "h", "body": "b", "focus": ["zz"]}, {"heading": "h", "body": "b", "stage": "flow:nope"}],
                         hero=[{"from": "a", "to": "b"}])
        errs = "\n".join(ec.validate_insight(ins, self.CTX))
        self.assertIn("story[0].focus: 'zz' is not on stage 'architecture'", errs)
        self.assertIn("story[1].stage: 'flow:nope' names no flow", errs)
        self.assertIn("hero[0]: a -> b is not a dependency drawn", errs)
        ins = self.valid(hero=[{"from": "b", "to": "a", "label": "uses"}],
                         flows=[{"id": "f", "title": "t", "steps": [{"from": "b", "to": "a", "msg": "m", "status": "new"}]}],
                         story=[{"heading": "h", "body": "b", "stage": "flow:f", "focus": ["#1", "b"]}, {"heading": "h", "body": "b"}])
        self.assertEqual(ec.validate_insight(ins, self.CTX), [])
        errs = "\n".join(ec.validate_insight(self.valid(story=[{"heading": "h", "body": "b"}]), self.CTX))
        self.assertIn("story: 1 steps", errs)

    def test_spec_traceability(self):
        req = {"id": "orders/confirm-email", "cap": "orders", "name": "Confirm email", "op": "ADDED", "text": "",
               "scenarios": [{"id": "smtp-down", "name": "SMTP down", "steps": []}], "file": "openspec/x.md", "line": 3, "change": "c1"}
        ctx = {**self.CTX, "openspec": {"changes": [{"id": "c1", "requirements": [req]}], "specs": []}}
        errs = "\n".join(ec.validate_insight(self.valid(), ctx))
        self.assertIn("map every ADDED/MODIFIED requirement to its implementation; missing orders/confirm-email", errs)
        ins = self.valid(spec=[{"req": "orders/confirm-email", "status": "implemented", "components": ["a"], "tests": ["f.rb:11"]}],
                         flows=[{"id": "f", "title": "t", "scenario": "orders/confirm-email#smtp-down",
                                 "steps": [{"from": "a", "to": "b", "msg": "m", "status": "new"}]}],
                         story=[{"heading": "h", "body": "b", "stage": "spec", "focus": ["orders/confirm-email"]}, {"heading": "h", "body": "b"}])
        self.assertEqual(ec.validate_insight(ins, ctx), [])
        ins = self.valid(spec=[{"req": "orders/confirm-email", "status": "missing"}])
        self.assertIn("spec[0].note: required", "\n".join(ec.validate_insight(ins, ctx)))

    def test_data_model_and_flow_data(self):
        dm = {"entities": [{"id": "order", "name": "Order", "change": "changed", "fields": ["+email: string"], "evidence": "f.rb:11"},
                           {"id": "customer", "name": "Customer", "change": "same"}],
              "relations": [{"from": "order", "to": "customer", "label": "n..1", "change": "same"}]}
        ins = self.valid(data_model=dm, flows=[{"id": "f", "title": "t", "steps": [
            {"from": "a", "to": "b", "msg": "m", "status": "new", "data": {"type": "Order", "fields": ["+email"]}}]}],
            story=[{"heading": "h", "body": "b", "stage": "data", "focus": ["order"]}, {"heading": "h", "body": "b"}])
        self.assertEqual(ec.validate_insight(ins, self.CTX), [])
        bad = self.valid(data_model={"entities": [{"id": "Order", "name": "O", "change": "added"}],
                                     "relations": [{"from": "x", "to": "y", "change": "added"}]})
        errs = "\n".join(ec.validate_insight(bad, self.CTX))
        self.assertIn("data_model.entities[0].id: 'Order' must be kebab-case", errs)
        self.assertIn("data_model.entities[0].evidence: required", errs)
        self.assertIn("data_model.relations[0].from: 'x' is not an entity", errs)

    def test_prose_rules(self):
        long = " ".join(["word"] * 30) + "."
        errs = "\n".join(ec.validate_insight(self.valid(tldr=long, intent="We leverage the queue."), self.CTX))
        self.assertIn("tldr: a sentence has 30 words, max 25", errs)
        self.assertIn("intent: replace vague word(s) leverage", errs)
        self.assertEqual(ec.validate_insight(self.valid(tldr="Short one. " * 6), self.CTX), [])


class OpenSpecParserTests(unittest.TestCase):
    SPEC = """## ADDED Requirements
### Requirement: Order confirmation email
The system SHALL email the customer when an order is created.

#### Scenario: Customer gets the email
- **WHEN** an order is created
- **THEN** the customer receives a confirmation

## MODIFIED Requirements
### Requirement: Create order
Orders SHALL carry an email.

## REMOVED Requirements
### Requirement: Fax receipts
**Reason**: nobody uses fax

## RENAMED Requirements
- FROM: `### Requirement: Old name`
- TO: `### Requirement: New name`
"""

    def test_requirements(self):
        reqs = ec.parse_requirements(self.SPEC, "orders", "openspec/changes/c/specs/orders/spec.md", None)
        self.assertEqual([(r["id"], r["op"]) for r in reqs], [
            ("orders/order-confirmation-email", "ADDED"), ("orders/create-order", "MODIFIED"),
            ("orders/fax-receipts", "REMOVED"), ("orders/new-name", "RENAMED")])
        self.assertEqual(reqs[0]["text"], "The system SHALL email the customer when an order is created.")
        self.assertEqual(reqs[0]["scenarios"][0]["id"], "customer-gets-the-email")
        self.assertEqual([x["k"] for x in reqs[0]["scenarios"][0]["steps"]], ["WHEN", "THEN"])
        self.assertEqual(reqs[3]["from"], "Old name")

    def test_tasks_and_proposal(self):
        t = ec.parse_tasks("## 1. Domain\n- [x] 1.1 Add email\n- [ ] 1.2 Port\n## 2. Infra\n- [x] 2.1 SMTP\n")
        self.assertEqual((t["done"], t["total"]), (2, 3))
        self.assertEqual([(g["title"], g["done"], g["total"]) for g in t["groups"]], [("1. Domain", 1, 2), ("2. Infra", 1, 1)])
        p = ec.parse_proposal("## Why\nCustomers ask **where** their order is.\n\n## What Changes\n- Send email\n- Add field\n")
        self.assertEqual(p["why"], "Customers ask where their order is.")
        self.assertEqual(p["what"], ["Send email", "Add field"])

    def test_paths(self):
        m = ec.OS_CHANGE.match("openspec/changes/archive/2026-01-02-add-email/proposal.md")
        self.assertEqual((m.group("id"), bool(m.group("arch"))), ("add-email", True))
        m = ec.OS_CHANGE.match("svc/openspec/changes/add-email/specs/orders/spec.md")
        self.assertEqual((m.group("root"), m.group("id"), m.group("rest")), ("svc/openspec", "add-email", "specs/orders/spec.md"))

    def test_main_spec_diff(self):
        base = ec.parse_requirements("## Requirements\n### Requirement: A\nx\n### Requirement: B\ny\n", "c", "p", "SPEC")
        head = ec.parse_requirements("## Requirements\n### Requirement: A\nx2\n### Requirement: C\nz\n", "c", "p", "SPEC")
        self.assertEqual([(r["id"], r["op"]) for r in ec.diff_requirements(base, head)], [("c/a", "MODIFIED"), ("c/c", "ADDED"), ("c/b", "REMOVED")])


if __name__ == "__main__":
    unittest.main()
