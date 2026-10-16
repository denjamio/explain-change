import { describe, expect, test } from "bun:test";
import { diffPath, parseDiff } from "../src/analysis/diff.ts";
import { fnmatch, matchesAny } from "../src/core/glob.ts";
import { dirname, extname, join, normpath } from "../src/core/paths.ts";
import { camelize, kebab, singularize, slugify, splitLines, truncate } from "../src/core/text.ts";

describe("globs", () => {
  test("folders, ** and plain paths", () => {
    expect(matchesAny("app/models/billing/invoice.rb", ["app/models/**"])).toBe(true);
    expect(matchesAny("app/models/order.rb", ["app/models"])).toBe(true);
    expect(matchesAny("app/models_legacy/order.rb", ["app/models"])).toBe(false);
    expect(matchesAny("billing/tests/test_invoice.py", ["**/test_*.py"])).toBe(true);
    expect(matchesAny("test_invoice.py", ["**/test_*.py"])).toBe(true);
    expect(matchesAny("app/models/billing/invoice.rb", ["app/*.rb"])).toBe(false);
  });

  test("a leading ./ is dropped, a leading dot folder is kept", () => {
    expect(matchesAny("app/x.rb", ["./app/**"])).toBe(true);
    expect(matchesAny(".github/workflows/ci.yml", [".github/**"])).toBe(true);
    expect(matchesAny("github/workflows/ci.yml", [".github/**"])).toBe(false);
  });

  test("fnmatch: * crosses . and ::", () => {
    expect(fnmatch("billing.models.invoice", "billing.*")).toBe(true);
    expect(fnmatch("Billing::Stripe::Charge", "Billing::*")).toBe(true);
    expect(fnmatch("orders.models", "billing.*")).toBe(false);
    expect(fnmatch("a1", "a[0-9]")).toBe(true);
    expect(fnmatch("ab", "a[!b]")).toBe(false);
  });
});

describe("paths follow Python's posixpath", () => {
  test("dirname, extname, join, normpath", () => {
    expect(dirname("a")).toBe("");
    expect(dirname("a/b/c.rb")).toBe("a/b");
    expect(extname(".env")).toBe("");
    expect(extname("a/b.test.ts")).toBe(".ts");
    expect(join("a", "/b")).toBe("/b");
    expect(join("", "x")).toBe("x");
    expect(normpath("a/./b/../c/")).toBe("a/c");
    expect(normpath("a/../..")).toBe("..");
  });
});

describe("text", () => {
  test("singularize", () => {
    for (const [plural, single] of [
      ["line_items", "line_item"],
      ["categories", "category"],
      ["addresses", "address"],
      ["people", "person"],
      ["statuses", "status"],
      ["boxes", "box"],
      ["class", "class"],
    ]) {
      expect(singularize(plural as string)).toBe(single as string);
    }
  });

  test("camelize with acronyms and inflections", () => {
    expect(camelize("api_client", { api: "API" })).toBe("APIClient");
    expect(camelize("html_parser", {}, { html_parser: "HTMLParser" })).toBe("HTMLParser");
  });

  test("ids and cuts count code points", () => {
    expect(kebab("Confirmación de pedido")).toBe("confirmacion-de-pedido");
    expect(slugify("feature/refunds v2")).toBe("feature-refunds-v2");
    expect(truncate("añadir 🚀 más", 9)).toBe("añadir 🚀…");
    expect(splitLines("a\r\nb\n\nc\n")).toEqual(["a", "b", "", "c"]);
  });
});

describe("diff parsing", () => {
  const DIFF = `diff --git a/app/models/a.rb b/app/models/a.rb
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
`;

  test("statuses, counts and renames", () => {
    const files = parseDiff(DIFF);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["app/models/a.rb", "M"],
      ["new.py", "R"],
      ["gone.rb", "D"],
    ]);
    expect([files[0]?.additions, files[0]?.deletions]).toEqual([2, 1]);
    expect(files[1]?.previousPath).toBe("old.py");
  });

  test("quoted, spaced and tabbed paths", () => {
    expect(diffPath("b/moved space.py\t")).toBe("b/moved space.py");
    expect(diffPath('"b/quo\\"te.py"')).toBe('b/quo"te.py');
    expect(diffPath('"a/tab\\there.py"')).toBe("a/tab\there.py");
    expect(diffPath('"a/\\303\\261.py"')).toBe("a/ñ.py");
    const diff =
      "diff --git a/with space.py b/moved space.py\nsimilarity index 50%\nrename from with space.py\n" +
      "rename to moved space.py\n--- a/with space.py\t\n+++ b/moved space.py\t\n@@ -1 +1,2 @@\n x\n+y\n" +
      'diff --git "a/tab\\there.py" "b/tab\\tmoved.py"\nsimilarity index 100%\n' +
      'rename from "tab\\there.py"\nrename to "tab\\tmoved.py"\n' +
      "diff --git a/same name.py b/same name.py\nold mode 100644\nnew mode 100755\n";
    expect(parseDiff(diff).map((f) => [f.path, f.previousPath, f.status])).toEqual([
      ["moved space.py", "with space.py", "R"],
      ["tab\tmoved.py", "tab\there.py", "R"],
      ["same name.py", null, "M"],
    ]);
  });
});
