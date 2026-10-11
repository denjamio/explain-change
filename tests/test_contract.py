"""The JSON Schema shipped for agents must match the limits and enums the validator enforces."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import explain_change as ec  # noqa: E402

SCHEMA = json.loads((ROOT / "schemas" / "insight.schema.json").read_text())


def node(path: str) -> dict:
    """'flows.steps.msg' → schema node; arrays are entered through their items, 'item' names the item itself."""
    parts = path.split(".")
    cur = SCHEMA["properties"][parts[0]]
    for part in parts[1:]:
        if "items" in cur:
            cur = cur["items"]
        if part != "item":
            cur = cur["properties"][part]
    return cur


class ContractTests(unittest.TestCase):
    def test_fields(self):
        self.assertEqual(sorted(SCHEMA["properties"]), sorted(ec.INSIGHT_FIELDS))

    def test_limits(self):
        for path, limit in ec.INSIGHT_LIMITS.items():
            n = node(path)
            key = "maxItems" if n.get("type") == "array" else "maxLength"
            self.assertEqual(n.get(key), limit, path)

    def test_enums(self):
        for path, values in ec.INSIGHT_ENUMS.items():
            self.assertEqual(node(path)["enum"], values, path)


if __name__ == "__main__":
    unittest.main()
