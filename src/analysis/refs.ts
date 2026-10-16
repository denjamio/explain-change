import { langOf } from "../core/lang.ts";
import { camelize, lineIndex, singularize, words } from "../core/text.ts";

/**
 * Raw references in one source file, before they are resolved to a file and a component. Regular expressions,
 * not parsers: each one is written for the declarations that matter to a dependency graph, and tested on them.
 */
export type RefKind = "ts" | "py" | "dj_model" | "rb_req" | "rb_rel" | "rb_const";

export interface Ref {
  kind: RefKind;
  /** The specifier as written: module, path, constant or namespace. */
  raw: string;
  line: number;
  /** py: the imported names; rb_const: the lexical nesting (["A", "A::B"]). */
  extra: readonly string[];
}

export interface Extracted {
  refs: Ref[];
  /** Django AppConfig.label, from apps.py. */
  djangoLabel?: string;
  /** Rails inflections: `inflect.acronym "API"` and `"html_parser" => "HTMLParser"`. */
  rubyAcronyms?: string[];
  rubyInflections?: [string, string][];
}

const TS_RE =
  /(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?|\bexport\s+(?:type\s+)?[\w*{}\s,$]*?\s*from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\n]+)['"]/dg;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm;
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)/gm;
const PY_DJ_MODEL = /\b(?:ForeignKey|OneToOneField|ManyToManyField|ForeignObject)\(\s*(?:to\s*=\s*)?['"]([\w.]+)['"]/g;
const PY_GET_MODEL = /\bget_model\(\s*['"](\w+)(?:\.(\w+)['"]|['"]\s*,\s*['"](\w+)['"])/g;
const PY_DOTTED_CALL =
  /\b(?:include|import_string|import_module|send_task|autodiscover_tasks)\(\s*\[?\s*['"]([A-Za-z_][\w.]*)['"]/g;
const PY_APP_LABEL = /^\s*label\s*=\s*['"](\w+)['"]/m;
const RB_REQ = /^[ \t]*require(_relative)?[ \t(]+['"]([^'"]+)['"]/gm;
const RB_DECL = /^(\s*)(?:module|class)\s+((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)([^\n]*)$/;
const RB_ASSOC = /^\s*(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)([^\n]*)$/;
const RB_CLASS_NAME = /class_name:?\s*(?:=>\s*)?['"]((?:::)?[A-Z][\w:]*)['"]/;
const RB_ACRONYM = /\.acronym\s*\(?\s*['"]([A-Za-z0-9]+)['"]/g;
const RB_INFLECT = /['"]([a-z0-9_]+)['"]\s*=>\s*['"]([A-Z][A-Za-z0-9]*)['"]/g;
const RB_CONST = /(?<![\w:@$])(?:::)?([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)/g;
const RB_STR = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const RB_REQUIRE_LINE = /^require(?:_relative|_dependency)?\b/;
const ERB_BLOCK = /<%[=-]?([\s\S]*?)-?%>/g;

/** Ruby code without string literals and without a trailing comment. */
const rubyCode = (line: string) => line.replace(RB_STR, "").split(" #")[0] as string;

export function extractRefs(path: string, text: string | null): Extracted {
  const lang = langOf(path);
  const out: Extracted = { refs: [] };
  if (!lang || text === null) return out;
  const lineOf = lineIndex(text);
  const add = (kind: RefKind, raw: string, line: number, extra: readonly string[] = []) =>
    out.refs.push({ kind, raw, line, extra });

  if (lang === "ts") {
    for (const m of text.matchAll(TS_RE)) add("ts", m[1] as string, lineOf(m.indices?.[1]?.[0] ?? m.index));
  } else if (lang === "py") {
    for (const m of text.matchAll(PY_IMPORT)) {
      for (const part of (m[1] as string).split(",")) {
        const mod = words(part)[0];
        if (mod) add("py", mod, lineOf(m.index));
      }
    }
    for (const m of text.matchAll(PY_FROM)) {
      const names = (m[2] as string)
        .replace(/^[()\s]+|[()\s]+$/g, "")
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n && n !== "*")
        .map((n) => words(n)[0] as string);
      add("py", m[1] as string, lineOf(m.index), names);
    }
    // Django references by string: lazy model relations, get_model(), include("app.urls"), celery tasks.
    for (const m of text.matchAll(PY_DJ_MODEL)) add("dj_model", m[1] as string, lineOf(m.index));
    for (const m of text.matchAll(PY_GET_MODEL)) add("dj_model", `${m[1]}.${m[2] ?? m[3]}`, lineOf(m.index));
    for (const m of text.matchAll(PY_DOTTED_CALL)) add("py", m[1] as string, lineOf(m.index));
    if (path.endsWith("apps.py")) {
      const label = PY_APP_LABEL.exec(text);
      if (label) out.djangoLabel = label[1];
    }
  } else if (lang === "erb") {
    // Only the Ruby inside <% %>: HTML text would produce false constants.
    const seen = new Set<string>();
    for (const block of text.matchAll(ERB_BLOCK)) {
      for (const m of (block[1] as string).replace(RB_STR, "").matchAll(RB_CONST)) {
        const c = m[1] as string;
        if (!seen.has(c)) {
          seen.add(c);
          add("rb_const", c, lineOf(block.index));
        }
      }
    }
  } else if (lang === "rb") {
    for (const m of text.matchAll(RB_REQ)) add(m[1] ? "rb_rel" : "rb_req", m[2] as string, lineOf(m.index));
    if (text.includes("inflect")) {
      out.rubyAcronyms = [...text.matchAll(RB_ACRONYM)].map((m) => m[1] as string);
      out.rubyInflections = [...text.matchAll(RB_INFLECT)].map((m) => [m[1] as string, m[2] as string]);
    }
    extractRubyConstants(text, add);
  }
  return out;
}

/**
 * Constants a Ruby file references, each with its lexical nesting. Nesting follows indentation: a line at or left
 * of an open module/class closes it. Associations (`has_many :line_items`) reference their class; polymorphic and
 * `through:` ones are skipped.
 */
function extractRubyConstants(text: string, add: (kind: RefKind, raw: string, line: number, extra: string[]) => void) {
  const stack: [number, string][] = [];
  const seen = new Set<string>();
  // One nesting array per scope, shared by the references inside it: big repositories hold millions of them.
  let nesting: string[] = [];
  let nestingKey = "";
  const syncNesting = () => {
    if (nesting.length !== stack.length || stack.some(([, n], i) => nesting[i] !== n)) {
      nesting = stack.map(([, n]) => n);
      nestingKey = nesting.join("\0");
    }
  };
  const addConst = (c: string, line: number) => {
    syncNesting();
    const key = `${c}\0${nestingKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    add("rb_const", c, line, nesting);
  };
  text.split("\n").forEach((line, index) => {
    const i = index + 1;
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#") || RB_REQUIRE_LINE.test(stripped)) return; // requires are read above
    const indent = line.length - line.trimStart().length;
    while (stack.length && (stack[stack.length - 1] as [number, string])[0] >= indent) stack.pop();
    const decl = RB_DECL.exec(line);
    if (decl) {
      const tail = decl[3] as string;
      const superclass = tail.includes("<") ? tail.slice(tail.indexOf("<") + 1) : "";
      for (const m of rubyCode(superclass).matchAll(RB_CONST)) addConst(m[1] as string, i);
      const name = (decl[2] as string).replace(/^:+/, "");
      const nested = stack.length > 0 && !(decl[2] as string).startsWith("::"); // `class ::A` is top level
      stack.push([indent, nested ? `${(stack[stack.length - 1] as [number, string])[1]}::${name}` : name]);
      return;
    }
    const assoc = RB_ASSOC.exec(line);
    if (assoc && !(assoc[3] as string).includes("polymorphic") && !(assoc[3] as string).includes("through:")) {
      const named = RB_CLASS_NAME.exec(assoc[3] as string);
      const plural = assoc[1] === "has_many" || assoc[1] === "has_and_belongs_to_many";
      const target = named
        ? (named[1] as string).replace(/^:+/, "")
        : camelize(plural ? singularize(assoc[2] as string) : (assoc[2] as string));
      addConst(target, i);
    }
    for (const m of rubyCode(line).matchAll(RB_CONST)) addConst(m[1] as string, i);
  });
}
