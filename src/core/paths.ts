/**
 * Repository paths: always POSIX ("app/models/order.rb"), relative to the repository root, as git prints them.
 * These helpers follow Python's posixpath, which the analysis was designed on: `dirname("a")` is "" (not "."),
 * `join` restarts at an absolute part, and `normpath` drops a trailing slash.
 */

export function dirname(p: string): string {
  const i = p.lastIndexOf("/") + 1;
  let head = p.slice(0, i);
  if (head && head !== "/".repeat(head.length)) head = head.replace(/\/+$/, "");
  return head;
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** The extension of the last path segment, with its dot; "" for none and for dotfiles (".env"). */
export function extname(p: string): string {
  const name = basename(p);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  if (/^\.+$/.test(name.slice(0, dot))) return "";
  return name.slice(dot);
}

export function join(first: string, ...parts: string[]): string {
  let out = first;
  for (const part of parts) {
    if (part.startsWith("/")) out = part;
    else if (out === "" || out.endsWith("/")) out += part;
    else out += `/${part}`;
  }
  return out;
}

export function normpath(p: string): string {
  if (p === "") return ".";
  const absolute = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== ".." || (!absolute && out.length === 0) || out[out.length - 1] === "..") out.push(part);
    else if (out.length) out.pop();
  }
  const joined = out.join("/");
  return absolute ? `/${joined}` : joined || ".";
}
