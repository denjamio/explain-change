import { describe, expect, test } from "bun:test";
import { buildGraph, ruleViolation, splitEdgeKey } from "../src/analysis/graph.ts";
import { diffRequirements, OS_CHANGE, parseProposal, parseRequirements, parseTasks } from "../src/analysis/openspec.ts";
import { portLinks } from "../src/analysis/ports.ts";
import { type Extracted, extractRefs } from "../src/analysis/refs.ts";
import { loadTsConfigs, SideIndex, type TsConfig } from "../src/analysis/resolve.ts";
import { extractSymbols } from "../src/analysis/symbols.ts";
import { detectStructure } from "../src/config/infer.ts";
import { Mapper } from "../src/config/mapper.ts";
import type { DiffLine } from "../src/contract/facts.ts";
import { makeConfig } from "./helpers.ts";

type Comp = Parameters<typeof makeConfig>[0][number];

function edgesFor(files: Record<string, string>, components: Comp[], tsconfigs: TsConfig[] = []) {
  const config = makeConfig(components);
  const mapper = new Mapper(config);
  const extracted = new Map<string, Extracted>(Object.entries(files).map(([p, t]) => [p, extractRefs(p, t)]));
  const graph = buildGraph(extracted, new SideIndex(new Set(Object.keys(files)), mapper, tsconfigs, extracted), mapper);
  const edges = Object.fromEntries([...graph.edges].map(([k, e]) => [splitEdgeKey(k).join("->"), e.count]));
  return { edges, unresolved: [...graph.unresolved.values()].reduce((a, b) => a + b, 0) };
}

describe("Django", () => {
  test("absolute, relative and from imports", () => {
    const { edges, unresolved } = edgesFor(
      {
        "backend/manage.py": "",
        "backend/orders/views.py": "from .models import Order\nfrom billing.services import charge\nimport django.db\n",
        "backend/orders/models.py": "from django.db import models\n",
        "backend/billing/__init__.py": "",
        "backend/billing/services.py": "def charge(): pass\n",
      },
      [
        { id: "orders", layer: "app", paths: ["backend/orders/**"] },
        { id: "billing", layer: "app", paths: ["backend/billing/**"] },
      ],
    );
    expect(edges).toEqual({ "orders->billing": 1 });
    expect(unresolved).toBe(0);
  });

  test("string relations and dotted calls", () => {
    const { edges, unresolved } = edgesFor(
      {
        "manage.py": "",
        "apps/orders/apps.py": "class OrdersConfig(AppConfig):\n    name = 'apps.orders'\n",
        "apps/orders/models.py":
          "from django.db import models\n\nclass Order(models.Model):\n" +
          "    customer = models.ForeignKey('crm.Customer', on_delete=models.CASCADE)\n" +
          "    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)\n" +
          "    parent = models.ForeignKey('self', on_delete=models.CASCADE)\n",
        "apps/orders/tasks.py": "from django.apps import apps\nInvoice = apps.get_model('billing', 'Invoice')\n",
        "apps/customers/apps.py": "class C(AppConfig):\n    name = 'apps.customers'\n    label = 'crm'\n",
        "apps/customers/models.py": "",
        "apps/billing/apps.py": "",
        "apps/billing/models/__init__.py": "",
        "config/urls.py": "from django.urls import include, path\nurlpatterns = [path('o/', include('orders.urls'))]\n",
        "apps/orders/urls.py": "",
      },
      [
        { id: "orders", layer: "apps", paths: ["apps/orders/**"] },
        { id: "customers", layer: "apps", paths: ["apps/customers/**"] },
        { id: "billing", layer: "apps", paths: ["apps/billing/**"] },
        { id: "project", layer: "entry", paths: ["config/**"] },
      ],
    );
    expect(edges).toEqual({ "orders->customers": 1, "orders->billing": 1, "project->orders": 1 });
    expect(unresolved).toBe(0);
  });
});

describe("Rails", () => {
  test("Zeitwerk constants and require_relative", () => {
    const { edges } = edgesFor(
      {
        "app/controllers/orders_controller.rb":
          "class OrdersController < ApplicationController\n  def create\n    Billing::Charge.call(order)  # comment Payments::Ignored\n" +
          "    Order.create!(params)\n    puts 'Fake::Constant'\n  end\nend\n",
        "app/controllers/application_controller.rb": "class ApplicationController; end\n",
        "app/services/billing/charge.rb":
          "module Billing\n  class Charge\n    def self.call(o) = Order.find(o)\n  end\nend\n",
        "app/models/order.rb": "class Order < ApplicationRecord\nend\n",
        "lib/tasks/helper.rb": "require_relative '../../app/models/order'\n",
      },
      [
        { id: "web", layer: "entry", paths: ["app/controllers/**"] },
        { id: "billing", layer: "app", paths: ["app/services/billing/**"] },
        { id: "models", layer: "domain", paths: ["app/models/**"] },
        { id: "tasks", layer: "app", paths: ["lib/**"] },
      ],
    );
    expect(edges).toEqual({ "web->billing": 1, "web->models": 1, "billing->models": 1, "tasks->models": 1 });
  });

  test("lines starting with 'required' are still read", () => {
    const { edges } = edgesFor(
      {
        "app/models/a.rb": "class A\n  def x\n    required = Billing::Plan.find(1)\n  end\nend\n",
        "app/services/billing/plan.rb": "module Billing\n  class Plan\n  end\nend\n",
      },
      [
        { id: "models", layer: "domain", paths: ["app/models/**"] },
        { id: "billing", layer: "app", paths: ["app/services/billing/**"] },
      ],
    );
    expect(edges).toEqual({ "models->billing": 1 });
  });

  test("constants a component owns outside its paths", () => {
    const { edges } = edgesFor(
      { "app/models/a.rb": "class A\n  Stripe::Charge.create\nend\n", "lib/stripe_client.rb": "" },
      [
        { id: "models", layer: "domain", paths: ["app/models/**"] },
        { id: "stripe", layer: "infra", paths: ["lib/stripe_client.rb"], constants: ["Stripe::*"] },
      ],
    );
    expect(edges).toEqual({ "models->stripe": 1 });
  });

  const COMPS: Comp[] = [
    { id: "models", layer: "domain", paths: ["app/models/**"] },
    { id: "billing", layer: "domain", paths: ["app/models/billing/**"] },
    { id: "api", layer: "entry", paths: ["app/controllers/**"] },
    { id: "svc", layer: "app", paths: ["app/services/**"] },
  ];

  test("sibling classes do not nest", () => {
    const files = {
      "app/services/a.rb":
        "module A\n  class B\n    def x; end\n  end\n\n  class C\n    def y = Invoice.new\n  end\nend\n",
      "app/models/a/b/invoice.rb": "module A\n  class B\n    class Invoice; end\n  end\nend\n",
      "app/models/billing/invoice.rb": "class Billing::Invoice; end\n",
      "app/models/invoice.rb": "class Invoice; end\n",
    };
    expect(edgesFor(files, COMPS).edges).toEqual({ "svc->models": 1 });
    const ref = extractRefs("app/services/a.rb", files["app/services/a.rb"]).refs.find((r) => r.raw === "Invoice");
    expect(ref?.extra).toEqual(["A", "A::C"]);
  });

  test("associations", () => {
    const order =
      'class Order < ApplicationRecord\n  has_many :line_items\n  belongs_to :customer\n  has_many :invoices, class_name: "Billing::Invoice"\n' +
      "  belongs_to :owner, polymorphic: true\n  has_many :taxes, through: :line_items\nend\n";
    const consts = new Set(extractRefs("app/models/order.rb", order).refs.map((r) => r.raw));
    for (const c of ["LineItem", "Customer", "Billing::Invoice"]) expect(consts.has(c)).toBe(true);
    expect(consts.has("Owner")).toBe(false);
    expect(consts.has("Tax")).toBe(false);
    const files = {
      "app/models/order.rb": order,
      "app/models/line_item.rb": "class LineItem < ApplicationRecord; end\n",
      "app/models/customer.rb": "class Customer < ApplicationRecord; end\n",
      "app/models/billing/invoice.rb": "class Billing::Invoice < ApplicationRecord; end\n",
    };
    expect(edgesFor(files, COMPS).edges).toEqual({ "models->billing": 1 });
  });

  test("Zeitwerk acronyms", () => {
    const files = {
      "config/initializers/inflections.rb":
        'ActiveSupport::Inflector.inflections(:en) do |inflect|\n  inflect.acronym "API"\nend\n',
      "app/controllers/api/v1/orders_controller.rb":
        "class API::V1::OrdersController\n  def index = Billing::Invoice.all\nend\n",
      "app/services/sync.rb": "class Sync\n  def call = API::V1::OrdersController\nend\n",
      "app/models/billing/invoice.rb": "",
    };
    expect(edgesFor(files, COMPS).edges).toEqual({ "api->billing": 1, "svc->api": 1 });
  });

  test("strings and comments are not constants; ERB reads only its Ruby", () => {
    const refs = extractRefs(
      "app/jobs/x.rb",
      'class X\n  def y\n    log "Family failed: #{e.message}" # Order\n    Invoice.new\n  end\nend\n',
    ).refs;
    expect(new Set(refs.map((r) => r.raw))).toEqual(new Set(["Invoice"]));
    const erb =
      '<h1>Account settings</h1>\n<%= render DS::Link.new(text: "Order now") %>\n<% if Current.user %>Family<% end %>';
    expect(new Set(extractRefs("app/views/a.html.erb", erb).refs.map((r) => r.raw))).toEqual(
      new Set(["DS::Link", "Current"]),
    );
  });

  test("CRLF files keep their declarations", () => {
    const refs = extractRefs(
      "app/services/a.rb",
      "module A\r\n  class C\r\n    def y = Invoice.new\r\n  end\r\nend\r\n",
    ).refs;
    expect(refs.find((r) => r.raw === "Invoice")?.extra).toEqual(["A", "A::C"]);
  });
});

describe("TypeScript and C#", () => {
  test("relative imports, tsconfig paths and baseUrl", () => {
    const files = {
      "src/app/main.ts":
        "import { x } from './util';\nimport { Order } from '@domain/order';\nimport y from 'lodash';\nexport * from 'core/log';\n",
      "src/app/util.ts": "",
      "src/domain/order.ts": "",
      "src/core/log/index.ts": "",
    };
    const tsconfigs: TsConfig[] = [{ dir: "", base: "src", hasBaseUrl: true, paths: [["@domain/*", ["domain/*"]]] }];
    const { edges } = edgesFor(
      files,
      [
        { id: "app", layer: "a", paths: ["src/app/**"] },
        { id: "domain", layer: "a", paths: ["src/domain/**"] },
        { id: "core", layer: "a", paths: ["src/core/**"] },
      ],
      tsconfigs,
    );
    expect(edges).toEqual({ "app->domain": 1, "app->core": 1 });
  });

  test("C# namespaces and project references", () => {
    const files = {
      "Shop.Api/OrdersController.cs":
        "using Shop.Billing;\nusing System;\nnamespace Shop.Api;\npublic class OrdersController {}\n",
      "Shop.Billing/Invoice.cs": "namespace Shop.Billing\n{\n  public class Invoice {}\n}\n",
      "Shop.Api/Shop.Api.csproj":
        '<Project><ItemGroup><ProjectReference Include="..\\Shop.Billing\\Shop.Billing.csproj" /></ItemGroup></Project>',
      "Shop.Billing/Shop.Billing.csproj": "<Project />",
    };
    const { edges } = edgesFor(files, [
      { id: "api", layer: "web", paths: ["Shop.Api/**"] },
      { id: "billing", layer: "domain", paths: ["Shop.Billing/**"] },
    ]);
    expect(edges).toEqual({ "api->billing": 2 });
  });

  test("Vue and Svelte: the <script> blocks, with Vite and SvelteKit aliases", () => {
    const files: Record<string, string> = {
      // Chatwoot: aliases in a shared Vite file; `vue` is a package, not a folder.
      "vite.shared.ts":
        "export const aliases = {\n  vue: 'vue/dist/vue.esm-bundler.js',\n  dashboard: path.resolve('./app/javascript/dashboard'),\n};\n",
      "app/javascript/dashboard/api/inbox.js": "export const getHealth = () => {};\n",
      "app/javascript/dashboard/routes/AccountHealth.vue":
        '<template>\n  <div>{{ import_me }}</div>\n</template>\n<script setup>\nimport { getHealth } from "dashboard/api/inbox";\nimport { ref } from "vue";\n</script>\n',
      // Immich: SvelteKit's $lib, implicit.
      "web/svelte.config.js": "export default { kit: {} };\n",
      "web/src/lib/sdk.ts": "export const getLogs = () => {};\n",
      "web/src/routes/Logs.svelte":
        '<script lang="ts">\n  import { getLogs } from "$lib/sdk";\n  import { getWorkflowLogs } from "@shop/sdk";\n</script>\n<p>logs</p>\n',
      // a monorepo package, imported by its name; its package.json points at a build the repository does not hold
      "packages/sdk/package.json": '{ "name": "@shop/sdk", "main": "./build/index.js" }',
      "packages/sdk/src/index.ts": "export const getWorkflowLogs = () => {};\n",
    };
    const read = (p: string) => files[p] ?? null;
    const { edges, unresolved } = edgesFor(
      files,
      [
        { id: "routes", layer: "web", paths: ["app/javascript/dashboard/routes/**", "web/src/routes/**"] },
        { id: "api", layer: "domain", paths: ["app/javascript/dashboard/api/**", "web/src/lib/**"] },
        { id: "sdk", layer: "domain", paths: ["packages/sdk/**"] },
      ],
      loadTsConfigs(Object.keys(files), read),
    );
    expect(edges).toEqual({ "routes->api": 2, "routes->sdk": 1 });
    expect(unresolved).toBe(0);
    // the template is no code: its text gives no reference, and lines keep their numbers
    expect(
      extractRefs("x.vue", files["app/javascript/dashboard/routes/AccountHealth.vue"] as string).refs.map((r) => [
        r.raw,
        r.line,
      ]),
    ).toEqual([
      ["dashboard/api/inbox", 5],
      ["vue", 6],
    ]);
  });

  test("SQL Server: Dapper calls stored procedures by name; DbScripts are migrations", () => {
    const files: Record<string, string> = {
      "src/Infrastructure.Dapper/Vault/FolderRepository.cs":
        'namespace Bit.Dapper;\npublic class FolderRepository\n{\n  void D() => Execute($"[{Schema}].[Folder_DeleteByIds]", new { Ids = ids.ToTvp("[dbo].[GuidIdArray]") });\n}\n',
      "src/Sql/dbo/Vault/Stored Procedures/Folder/Folder_DeleteByIds.sql":
        "CREATE PROCEDURE [dbo].[Folder_DeleteByIds]\n    @Ids AS [dbo].[GuidIdArray] READONLY\nAS\nBEGIN\nEND\n",
      // the migration script creates it too: the project's own file wins
      "util/Migrator/DbScripts/2026-08-12_00_AddFolderDeleteByIds.sql":
        "CREATE OR ALTER PROCEDURE [dbo].[Folder_DeleteByIds]\nAS\nBEGIN\nEND\nGO\n",
    };
    const { edges, unresolved } = edgesFor(files, [
      { id: "dapper", layer: "adapters", paths: ["src/Infrastructure.Dapper/**"] },
      { id: "schema", layer: "database", paths: ["src/Sql/**", "util/Migrator/**"] },
    ]);
    expect(edges).toEqual({ "dapper->schema": 1 }); // the procedure; [dbo].[GuidIdArray] is a table type
    expect(unresolved).toBe(0);
    const mapper = new Mapper(makeConfig([{ id: "schema", layer: "database", paths: ["util/**"] }]));
    expect(mapper.category("util/Migrator/DbScripts/2026-08-12_00_AddFolderDeleteByIds.sql")).toBe("migration");
  });

  test("ports and adapters: who declares an interface, who implements it", () => {
    const files: Record<string, string> = {
      "Core/Vault/IFolderRepository.cs":
        "namespace Bit.Core.Vault;\npublic interface IFolderRepository : IRepository<Folder, Guid>\n{\n}\n",
      "Core/Vault/DeleteManyFoldersCommand.cs":
        "namespace Bit.Core.Vault;\npublic class DeleteManyFoldersCommand(\n    IFolderRepository folderRepository,\n    IPushNotificationService push)\n    : IDeleteManyFoldersCommand\n{\n}\n",
      "Dapper/FolderRepository.cs":
        "namespace Bit.Dapper;\npublic class FolderRepository : Repository<Folder, Guid>, IFolderRepository\n{\n}\n",
      "web/gateway.ts": "export interface EmailGateway {}\n",
      "adapters/postmark.ts":
        "export class PostmarkGateway extends Base<Config> implements EmailGateway, Disposable {\n}\n",
    };
    const extracted = new Map(Object.entries(files).map(([p, t]) => [p, extractRefs(p, t)]));
    expect(extracted.get("Dapper/FolderRepository.cs")?.implements).toEqual(["IFolderRepository"]);
    expect(extracted.get("Core/Vault/DeleteManyFoldersCommand.cs")?.implements).toEqual(["IDeleteManyFoldersCommand"]);
    const mapper = new Mapper(
      makeConfig([
        { id: "vault", layer: "core", paths: ["Core/Vault/**"] },
        { id: "dapper", layer: "adapters", paths: ["Dapper/**"] },
        { id: "notifications", layer: "core", paths: ["web/**"] },
        { id: "email", layer: "adapters", paths: ["adapters/**"] },
      ]),
    );
    expect(portLinks(extracted, mapper)).toEqual([
      { from: "notifications", to: "email", interfaces: ["EmailGateway"] },
      { from: "vault", to: "dapper", interfaces: ["IFolderRepository"] },
    ]);
  });

  test("C#: a using sees only its project and the projects it references", () => {
    // Shop.Api declares a namespace of Shop.Billing, as real code does (Bitwarden's Api has a Bit.Core.Enums file).
    // Shop.Billing does not reference Shop.Api, so its using of that namespace cannot reach Shop.Api.
    const files = {
      "Shop.Api/Shop.Api.csproj":
        '<Project><ItemGroup><ProjectReference Include="..\\Shop.Billing\\Shop.Billing.csproj" /></ItemGroup></Project>',
      "Shop.Api/OrdersController.cs":
        "using Shop.Billing.Enums;\nnamespace Shop.Api;\npublic class OrdersController {}\n",
      "Shop.Api/Push/PushType.cs": "namespace Shop.Billing.Enums;\npublic enum PushType {}\n",
      "Shop.Billing/Shop.Billing.csproj": "<Project />",
      "Shop.Billing/Enums/Status.cs": "namespace Shop.Billing.Enums;\npublic enum Status {}\n",
      "Shop.Billing/Invoice.cs": "using Shop.Billing.Enums;\nnamespace Shop.Billing;\npublic class Invoice {}\n",
    };
    const { edges } = edgesFor(files, [
      { id: "api", layer: "web", paths: ["Shop.Api/**"] },
      { id: "billing", layer: "domain", paths: ["Shop.Billing/**"] },
    ]);
    expect(edges).toEqual({ "api->billing": 2 });
  });
});

describe("structure inference", () => {
  test("Rails layout", () => {
    const st = detectStructure([
      "Gemfile",
      "config/application.rb",
      "config/routes.rb",
      "app/controllers/orders_controller.rb",
      "app/models/order.rb",
      "app/services/checkout.rb",
      "app/mailers/order_mailer.rb",
      "app/views/orders/show.html.erb",
      "app/views/settings/show.html.erb",
      "app/helpers/orders_helper.rb",
      "app/javascript/controllers/map_controller.js",
      "lib/money.rb",
      "spec/models/order_spec.rb",
    ]);
    expect(st.kind).toBe("rails");
    const got = Object.fromEntries(st.components.map((c) => [c.id, [c.layer, c.paths]]));
    expect(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v[0]]))).toEqual({
      ui: "web",
      controllers: "web",
      services: "application",
      models: "domain",
      mailers: "infrastructure",
      lib: "infrastructure",
    });
    // Presentation is one component; routes belong to the controllers.
    expect(got.ui?.[1]).toEqual(["app/views/**", "app/helpers/**", "app/javascript/**"]);
    expect(got.controllers?.[1]).toEqual(["app/controllers/**", "config/routes.rb"]);
  });

  test("a big Rails namespace is named after the concept", () => {
    const files = [
      "Gemfile",
      "config/application.rb",
      "app/models/family.rb",
      ...Array.from({ length: 8 }, (_, i) => `app/models/family/part_${i}.rb`),
      ...Array.from({ length: 25 }, (_, i) => `app/models/thing_${i}.rb`),
    ];
    const comps = Object.fromEntries(detectStructure(files).components.map((c) => [c.id, c]));
    expect(comps["models-family"]?.name).toBe("Family");
    expect(comps["models-family"]?.paths).toEqual(["app/models/family.rb", "app/models/family/**"]);
    const mapper = new Mapper(makeConfig(Object.values(comps).map(({ id, layer, paths }) => ({ id, layer, paths }))));
    expect(mapper.component("app/models/family.rb")).toBe("models-family");
  });

  test("Django layout with a project package and nested apps", () => {
    const st = detectStructure([
      "manage.py",
      "hc/settings.py",
      "hc/urls.py",
      "hc/accounts/models.py",
      "hc/api/views.py",
      "hc/lib/emails.py",
      "hc/integrations/__init__.py",
      ...["a", "b", "c", "d", "e", "f"].map((n) => `hc/integrations/${n}/models.py`),
    ]);
    expect(st.kind).toBe("django");
    const got = Object.fromEntries(st.components.map((c) => [c.id, [c.layer, c.paths]]));
    expect(got.project).toEqual(["web", ["hc/*.py", "hc/settings/**"]]);
    expect(got.api?.[0]).toBe("web");
    expect(got.lib?.[0]).toBe("shared");
    expect(got.integrations).toBeDefined();
    expect(got.a).toBeUndefined();
  });

  test("the most specific path wins", () => {
    const mapper = new Mapper(
      makeConfig([
        { id: "models", layer: "d", paths: ["app/models/**"] },
        { id: "billing", layer: "d", paths: ["app/models/billing/**"] },
      ]),
    );
    expect(mapper.component("app/models/billing/invoice.rb")).toBe("billing");
    expect(mapper.component("app/models/order.rb")).toBe("models");
  });
});

describe("rules", () => {
  test("allow, forbid and same layer", () => {
    const config = makeConfig(
      [
        { id: "o", layer: "domain", paths: ["d/**"] },
        { id: "m", layer: "infra", paths: ["i/**"] },
      ],
      ["domain", "infra"],
      { allow: ["infra -> domain"] },
    );
    const layerOf = new Map([
      ["o", "domain"],
      ["m", "infra"],
    ]);
    expect(ruleViolation("m", "o", config, layerOf)).toBeNull();
    expect(ruleViolation("o", "m", config, layerOf)).toBe("not allowed: domain -> infra");
    config.rules.forbid.push(["m", "domain"]);
    expect(ruleViolation("m", "o", config, layerOf)).toBe("forbidden: m -> domain");
  });
});

describe("symbols and endpoints", () => {
  const hunk = (lines: DiffLine[]) => [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: lines.length - 1, header: "", lines },
  ];

  test("declarations and routes on changed lines", () => {
    const rb = {
      path: "app/models/order.rb",
      hunks: hunk([
        ["-", "class Order < ApplicationRecord"],
        ["+", "class Order < ActiveRecord::Base"],
        ["+", "  def refund!(amount)"],
      ]),
    };
    const routes = { path: "config/routes.rb", hunks: hunk([["+", "  resources :refunds, only: :create"]]) };
    const urls = { path: "billing/urls.py", hunks: hunk([["+", '    path("invoices/<int:pk>/", views.detail),']]) };
    const got = new Set(
      [rb, routes, urls].flatMap((f) => extractSymbols(f).map((s) => `${s.kind}|${s.name}|${s.delta}`)),
    );
    expect(got).toEqual(
      new Set([
        "class|Order|changed",
        "def|refund!|added",
        "endpoint|resources refunds|added",
        "endpoint|path invoices/<int:pk>/|added",
      ]),
    );
  });

  test("routes count only in route files", () => {
    const syms = (path: string, line: string) =>
      new Set(extractSymbols({ path, hunks: hunk([["+", line]]) }).map((s) => `${s.kind}|${s.name}`));
    expect(syms("config/routes.rb", "  delete :sessions")).toEqual(new Set(["endpoint|delete sessions"]));
    expect(syms("config/routes/admin.rb", "  get 'stats'")).toEqual(new Set(["endpoint|get stats"]));
    expect(syms("app/models/user.rb", "    delete user")).toEqual(new Set());
    expect(syms("orders/urls.py", 'path("orders/", views.index),')).toEqual(new Set(["endpoint|path orders/"]));
    expect(syms("orders/api/urls/v1.py", 'path("v1/", api),')).toEqual(new Set(["endpoint|path v1/"]));
    expect(syms("orders/services.py", 'x = path("orders/", y)')).toEqual(new Set());
    expect(syms("api/routers.py", 'router.register(r"orders", OrderViewSet)')).toEqual(
      new Set(["endpoint|register orders"]),
    );
  });

  test("C#: public types and methods, ASP.NET endpoints", () => {
    const syms = (lines: string[]) =>
      new Set(
        extractSymbols({ path: "Shop.Api/OrdersController.cs", hunks: hunk(lines.map((l) => ["+", l])) }).map(
          (s) => `${s.kind}|${s.name}`,
        ),
      );
    expect(
      syms([
        "public sealed partial class OrdersController : ControllerBase",
        '    [HttpPost("refunds")]',
        "    public async Task<IActionResult> Refund(int id)",
        "    private void Helper()",
        "public record OrderDto(int Id);",
      ]),
    ).toEqual(new Set(["class|OrdersController", "endpoint|HttpPost refunds", "method|Refund", "record|OrderDto"]));
  });
});

describe("OpenSpec", () => {
  const SPEC = `## ADDED Requirements
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
- FROM: \`### Requirement: Old name\`
- TO: \`### Requirement: New name\`
`;

  test("requirements with their operation and scenarios", () => {
    const reqs = parseRequirements(SPEC, "orders", "openspec/changes/c/specs/orders/spec.md", null);
    expect(reqs.map((r) => [r.id, r.op])).toEqual([
      ["orders/order-confirmation-email", "ADDED"],
      ["orders/create-order", "MODIFIED"],
      ["orders/fax-receipts", "REMOVED"],
      ["orders/new-name", "RENAMED"],
    ]);
    expect(reqs[0]?.text).toBe("The system SHALL email the customer when an order is created.");
    expect(reqs[0]?.scenarios[0]?.id).toBe("customer-gets-the-email");
    expect(reqs[0]?.scenarios[0]?.steps.map((s) => s.keyword)).toEqual(["WHEN", "THEN"]);
    expect(reqs[3]?.renamedFrom).toBe("Old name");
  });

  test("tasks and proposal", () => {
    const t = parseTasks("## 1. Domain\n- [x] 1.1 Add email\n- [ ] 1.2 Port\n## 2. Infra\n- [x] 2.1 SMTP\n");
    expect([t.done, t.total]).toEqual([2, 3]);
    expect(t.groups.map((g) => [g.title, g.done, g.total])).toEqual([
      ["1. Domain", 1, 2],
      ["2. Infra", 1, 1],
    ]);
    const p = parseProposal(
      "## Why\nCustomers ask **where** their order is.\n\n## What Changes\n- Send email\n- Add field\n",
    );
    expect(p.why).toBe("Customers ask where their order is.");
    expect(p.what).toEqual(["Send email", "Add field"]);
  });

  test("task items point at the groups kept", () => {
    const t = parseTasks("## Notes\nnothing to do\n## Work\n- [x] one\n");
    expect(t.groups.map((g) => g.title)).toEqual(["Work"]);
    expect(t.items[0]?.group).toBe(0);
  });

  test("change paths, active and archived", () => {
    const a = OS_CHANGE.exec("openspec/changes/archive/2026-01-02-add-email/proposal.md")?.groups;
    expect([a?.id, Boolean(a?.archive)]).toEqual(["add-email", true]);
    const b = OS_CHANGE.exec("svc/openspec/changes/add-email/specs/orders/spec.md")?.groups;
    expect([b?.root, b?.id, b?.rest]).toEqual(["svc/openspec", "add-email", "specs/orders/spec.md"]);
  });

  test("main spec diff", () => {
    const base = parseRequirements("## Requirements\n### Requirement: A\nx\n### Requirement: B\ny\n", "c", "p", "SPEC");
    const head = parseRequirements(
      "## Requirements\n### Requirement: A\nx2\n### Requirement: C\nz\n",
      "c",
      "p",
      "SPEC",
    );
    expect(diffRequirements(base, head).map((r) => [r.id, r.op])).toEqual([
      ["c/a", "MODIFIED"],
      ["c/c", "ADDED"],
      ["c/b", "REMOVED"],
    ]);
  });
});
