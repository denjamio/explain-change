"""End-to-end: build the example scenarios twice from real git repos and check facts and determinism."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "examples"))
import build_examples as bx  # noqa: E402


def run_all(out_dir: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        return {sc["name"]: bx.build(sc, Path(tmp), out_dir) for sc in bx.SCENARIOS}


class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dirs = [tempfile.TemporaryDirectory(), tempfile.TemporaryDirectory()]
        cls.rows = [run_all(Path(d.name)) for d in cls.dirs]

    @classmethod
    def tearDownClass(cls):
        for d in cls.dirs:
            d.cleanup()

    def ctx(self, name):
        return json.loads((Path(self.dirs[0].name) / f"{name}.context.json").read_text())

    def test_byte_identical(self):
        for sc in bx.SCENARIOS:
            a = (Path(self.dirs[0].name) / f"{sc['name']}.html").read_bytes()
            b = (Path(self.dirs[1].name) / f"{sc['name']}.html").read_bytes()
            self.assertEqual(a, b, sc["name"])

    def edges(self, name):
        return {(e["from"], e["to"]): (e["status"], bool(e["violation"]), bool(e["violation"] and e["violation"]["existing"]))
                for e in self.ctx(name)["edges"]}

    def statuses(self, name):
        return {c["id"]: c["status"] for c in self.ctx(name)["components"]}

    def test_rails(self):
        e = self.edges("01-marketplace-rails-refunds-es")
        for pair in [("controllers", "refunds"), ("refunds", "models"), ("refunds", "payments"), ("refunds", "mailers")]:
            self.assertEqual(e[pair], ("new", False, False), pair)
        self.assertEqual(self.ctx("01-marketplace-rails-refunds-es")["stats"]["violations_new"], 0)

    def test_django_inferred(self):
        ctx = self.ctx("02-ledger-django-no-config")
        self.assertTrue(ctx["config"]["inferred"])
        e = self.edges("02-ledger-django-no-config")
        self.assertIn(("reports", "billing"), e)
        self.assertIn(("reports", "accounts"), e)

    def test_django_openspec(self):
        e = self.edges("03-orders-django-openspec-es")
        self.assertEqual(e[("orders-svc", "notifications")], ("new", False, False))
        self.assertEqual(e[("notifications", "orders-model")], ("new", False, False))
        self.assertEqual(self.statuses("03-orders-django-openspec-es")["notifications"], "new")
        reqs = {r["id"]: r["op"] for c in self.ctx("03-orders-django-openspec-es")["openspec"]["changes"] for r in c["requirements"]}
        self.assertEqual(reqs, {"orders/email-de-confirmacion": "ADDED", "orders/crear-pedido": "MODIFIED"})


if __name__ == "__main__":
    unittest.main()
