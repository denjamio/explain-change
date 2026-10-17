/** Text helpers. Lengths and cuts count code points, so a limit means the same for "ñ" and for an emoji. */

export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function cpSlice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join("");
}

/** Cuts to `limit` code points, ending in "…" when it cuts. */
export function truncate(text: string, limit: number): string {
  return cpLength(text) <= limit ? text : `${cpSlice(text, 0, limit - 1).trimEnd()}…`;
}

/** Lines as an editor shows them: split on \n, \r\n or \r; a final line break does not add an empty line. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The 1-based line of a character offset. */
export function lineIndex(text: string): (pos: number) => number {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] as number) <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

/** Plain string order (by UTF-16 code unit), the same on every machine and locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort comparator over keys: each key is compared in order, numbers numerically and strings with compareStrings. */
export function byKeys<T>(key: (x: T) => readonly (string | number | boolean)[]): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      const x = ka[i] as string | number | boolean;
      const y = kb[i] as string | number | boolean;
      if (x === y) continue;
      if (typeof x === "string" && typeof y === "string") return compareStrings(x, y);
      return Number(x) < Number(y) ? -1 : 1;
    }
    return ka.length - kb.length;
  };
}

/** Text safe for a file name: letters, digits, `.`, `_` and `-`; at most 80 characters. */
export function slugify(text: string): string {
  return (
    text
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "change"
  );
}

/** kebab-case ASCII id: "Confirmación de pedido" → "confirmacion-de-pedido". */
export function kebab(text: string, limit = 60): string {
  const ascii = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, limit) || "x"
  );
}

/** Zeitwerk-style camelize. acronyms: {"api": "API"}; inflections: {"html_parser": "HTMLParser"}. */
export function camelize(
  segment: string,
  acronyms: Record<string, string> = {},
  inflections: Record<string, string> = {},
): string {
  if (Object.hasOwn(inflections, segment)) return inflections[segment] as string;
  return segment
    .split("_")
    .filter(Boolean)
    .map((part) => (Object.hasOwn(acronyms, part) ? acronyms[part] : part.slice(0, 1).toUpperCase() + part.slice(1)))
    .join("");
}

const IRREGULAR_PLURALS: Record<string, string> = {
  people: "person",
  men: "man",
  women: "woman",
  children: "child",
  feet: "foot",
  teeth: "tooth",
  mice: "mouse",
  geese: "goose",
  data: "datum",
  criteria: "criterion",
};
const PLURAL_SUFFIXES: [string, string][] = [
  ["ies", "y"],
  ["sses", "ss"],
  ["shes", "sh"],
  ["ches", "ch"],
  ["xes", "x"],
  ["zzes", "zz"],
  ["uses", "us"],
  ["oes", "o"],
  ["ves", "f"],
];

/** Enough of ActiveSupport's rules for association names. */
export function singularize(word: string): string {
  if (Object.hasOwn(IRREGULAR_PLURALS, word)) return IRREGULAR_PLURALS[word] as string;
  for (const [suffix, repl] of PLURAL_SUFFIXES) {
    if (word.endsWith(suffix) && word.length > suffix.length + 1) return word.slice(0, -suffix.length) + repl;
  }
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** Python's str.split() without arguments: words separated by whitespace runs. */
export function words(text: string): string[] {
  const t = text.trim();
  return t ? t.split(/\s+/) : [];
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** A count and its noun, singular for 1: `plural(1, "file")` = "1 file", `plural(3, "file")` = "3 files". */
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
