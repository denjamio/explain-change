import type {
  Artifact,
  Delta,
  Facts,
  OpenSpecFacts,
  Requirement,
  Scenario,
  SpecChange,
  Tasks,
} from "../contract/facts.ts";
import { REQUIREMENT_OPS } from "../contract/facts.ts";
import { byKeys, kebab, splitLines, truncate } from "../core/text.ts";

/*
 * Spec-driven changes live in openspec/changes/<id>/ (proposal.md, design.md, tasks.md and requirement deltas in
 * specs/<capability>/spec.md); archiving moves them to changes/archive/<date>-<id>/ and merges the deltas into
 * openspec/specs/<capability>/spec.md. Everything here is parsed, never guessed: the agent only maps requirements
 * to code.
 */

export const OS_CHANGE =
  /^(?<root>(?:.*\/)?openspec)\/changes\/(?:(?<archive>archive)\/(?:\d{4}-\d{2}-\d{2}-)?)?(?<id>[^/]+)\/(?<rest>.+)$/;
export const OS_SPEC = /^(?<root>(?:.*\/)?openspec)\/specs\/(?<capability>[^/]+)\/spec\.md$/;

type Op = Requirement["op"];
type Line = [number, string];

/** The file fields OpenSpec parsing needs: git's status letter tells added, renamed (moved) and deleted apart. */
export interface SpecFile {
  path: string;
  previousPath: string | null;
  status: "A" | "M" | "D" | "R";
}

export function mdPlain(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** [heading, lines] for headings of exactly `level`; content before the first one is ["", lines]. */
function mdSections(text: string, level = 2): [string, Line[]][] {
  const out: [string, Line[]][] = [["", []]];
  const mark = `${"#".repeat(level)} `;
  splitLines(text).forEach((line, i) => {
    if (line.startsWith(mark)) out.push([mdPlain(line.slice(mark.length)), []]);
    else (out[out.length - 1] as [string, Line[]])[1].push([i + 1, line]);
  });
  return out;
}

function firstParagraph(lines: Line[], limit: number): string {
  const para: string[] = [];
  for (const [, line] of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      if (para.length) break;
      continue;
    }
    para.push(
      para.length
        ? line.trim()
        : line
            .trim()
            .replace(/^[-* ]+/, "")
            .trim(),
    );
  }
  return truncate(mdPlain(para.join(" ")), limit);
}

function bullets(lines: Line[], limit: number, n: number): string[] {
  return lines
    .map(([, l]) => l)
    .filter((l) => /^[-*]\s+\S/.test(l))
    .map((l) => truncate(mdPlain(l.replace(/^\s*[-*]\s+/, "")), limit))
    .slice(0, n);
}

/** Requirements with their scenarios, in file order. `op` comes from '## ADDED Requirements' and its kin. */
export function parseRequirements(text: string, capability: string, path: string, defaultOp: Op | null): Requirement[] {
  const reqs: Requirement[] = [];
  let op: Op | null = defaultOp;
  let cur: Requirement | null = null;
  let scenario: Scenario | null = null;
  let body: string[] = [];
  const close = () => {
    if (cur) cur.text = truncate(mdPlain(body.join(" ")), 280);
  };
  splitLines(text).forEach((line, index) => {
    const i = index + 1;
    let m = /^##\s+(\w+)\s+Requirements\b/i.exec(line);
    if (m) {
      close();
      const named = (m[1] as string).toUpperCase();
      op = (REQUIREMENT_OPS as readonly string[]).includes(named) && named !== "SPEC" ? (named as Op) : defaultOp;
      cur = null;
      scenario = null;
      body = [];
      return;
    }
    m = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line);
    if (m) {
      close();
      const name = mdPlain(m[1] as string);
      cur = {
        id: `${capability}/${kebab(name)}`,
        capability,
        name: truncate(name, 120),
        op: op ?? "SPEC",
        text: "",
        scenarios: [],
        file: path,
        line: i,
        change: null,
        merged: false,
        renamedFrom: null,
      };
      scenario = null;
      body = [];
      reqs.push(cur);
      return;
    }
    if (!cur) {
      if (op === "RENAMED") {
        // - FROM: `### Requirement: Old` / - TO: `### Requirement: New`
        const fm = /^\s*-\s*(FROM|TO):\s*`?(?:###\s*)?(?:Requirement:\s*)?(.+?)`?\s*$/i.exec(line);
        const last = reqs[reqs.length - 1];
        if (fm && (fm[1] as string).toUpperCase() === "FROM") {
          reqs.push({
            id: "",
            capability,
            name: "",
            op: "RENAMED",
            text: "",
            scenarios: [],
            file: path,
            line: i,
            change: null,
            merged: false,
            renamedFrom: mdPlain(fm[2] as string),
          });
        } else if (fm && last && last.op === "RENAMED" && !last.name) {
          const name = mdPlain(fm[2] as string);
          last.id = `${capability}/${kebab(name)}`;
          last.name = truncate(name, 120);
        }
      }
      return;
    }
    m = /^####\s+Scenario:\s*(.+?)\s*$/.exec(line);
    if (m) {
      scenario = { id: kebab(m[1] as string), name: truncate(mdPlain(m[1] as string), 120), steps: [], line: i };
      (cur as Requirement).scenarios.push(scenario);
      return;
    }
    if (line.startsWith("## ")) {
      close();
      op = null;
      cur = null;
      scenario = null;
      return;
    }
    if (scenario) {
      const sm = /^\s*[-*]\s+(?:\*\*)?(GIVEN|WHEN|THEN|AND|BUT)(?:\*\*)?\s+(.*)$/i.exec(line);
      if (sm && (scenario as Scenario).steps.length < 8) {
        (scenario as Scenario).steps.push({
          keyword: (sm[1] as string).toUpperCase() as Scenario["steps"][number]["keyword"],
          text: truncate(mdPlain(sm[2] as string), 160),
        });
      }
    } else if (line.trim() && !line.startsWith("#") && body.join(" ").length < 400) body.push(line.trim());
  });
  close();
  return reqs.filter((r) => r.id);
}

export function parseTasks(text: string): Tasks {
  const groups: Tasks["groups"] = [];
  const items: Tasks["items"] = [];
  splitLines(text).forEach((line, index) => {
    let m = /^#{2,3}\s+(.+)$/.exec(line);
    if (m) {
      groups.push({ title: truncate(mdPlain(m[1] as string), 80), done: 0, total: 0 });
      return;
    }
    m = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (!m) return;
    if (!groups.length) groups.push({ title: "", done: 0, total: 0 });
    const group = groups[groups.length - 1] as Tasks["groups"][number];
    const done = m[1] !== " ";
    group.total++;
    if (done) group.done++;
    if (items.length < 60) {
      items.push({ text: truncate(mdPlain(m[2] as string), 140), done, line: index + 1, group: groups.length - 1 });
    }
  });
  const kept = groups.filter((g) => g.total);
  // Item group indexes point at `groups`; renumber them for the groups kept.
  const renumber = new Map(groups.map((g, i) => [i, kept.indexOf(g)]));
  return {
    done: kept.reduce((a, g) => a + g.done, 0),
    total: kept.reduce((a, g) => a + g.total, 0),
    groups: kept,
    items: items.map((x) => ({ ...x, group: renumber.get(x.group) ?? x.group })),
  };
}

export function parseProposal(text: string): { why: string; what: string[]; impact: string[] } {
  const out = { why: "", what: [] as string[], impact: [] as string[] };
  for (const [title, lines] of mdSections(text)) {
    const t = title.toLowerCase();
    if (t.startsWith("why") && !out.why) out.why = firstParagraph(lines, 400);
    else if (t.startsWith("what") && !out.what.length) out.what = bullets(lines, 160, 8);
    else if (t.startsWith("impact") && !out.impact.length) out.impact = bullets(lines, 160, 6);
  }
  return out;
}

export function parseDesign(text: string): string[] {
  let decisions: string[] = [];
  for (const [title, lines] of mdSections(text)) {
    if (!title.toLowerCase().startsWith("decision")) continue;
    const heads = lines.filter(([, l]) => /^###\s+\S/.test(l)).map(([, l]) => mdPlain(l.replace(/^#+\s*/, "")));
    const bold = lines.flatMap(([, l]) => {
      const m = /^[-*]\s+\*\*(.+?)\*\*/.exec(l);
      return m ? [mdPlain(m[1] as string)] : [];
    });
    decisions = (heads.length ? heads : bold)
      .map((d) => truncate(d.replace(/^(Decision\s*\d*[:.]?\s*)/i, ""), 100))
      .slice(0, 8);
  }
  return decisions;
}

/** What makes two versions of a requirement differ: its text and its scenarios. */
const requirementShape = (r: Requirement) => JSON.stringify([r.text, r.scenarios.map((s) => [s.name, s.steps])]);

/** A main spec changed in the diff (usually an archive merge), as requirement-level ADDED/MODIFIED/REMOVED. */
export function diffRequirements(base: Requirement[], head: Requirement[]): Requirement[] {
  const b = new Map(base.map((r) => [r.id, r]));
  const h = new Map(head.map((r) => [r.id, r]));
  const out: Requirement[] = [];
  for (const r of head) {
    const old = b.get(r.id);
    if (!old) out.push({ ...r, op: "ADDED" });
    else if (requirementShape(r) !== requirementShape(old)) out.push({ ...r, op: "MODIFIED" });
  }
  for (const r of base) if (!h.has(r.id)) out.push({ ...r, op: "REMOVED" });
  return out;
}

/** [openspec root, change id] when `path` is inside an OpenSpec change, active or archived. */
export function changeOf(path: string | null): [string, string] | null {
  const m = OS_CHANGE.exec(path ?? "");
  return m?.groups && m.groups.id !== "archive" ? [m.groups.root as string, m.groups.id as string] : null;
}

type Read = (path: string) => string | null;

/** OpenSpec changes the diff touches (plus `extra` ids from --spec) and the main specs it edits. */
export function collectOpenSpec(
  files: SpecFile[],
  headFiles: ReadonlySet<string>,
  baseFiles: ReadonlySet<string>,
  readHead: Read,
  readBase: Read,
  extra: readonly string[],
): OpenSpecFacts | null {
  const keys = new Map<string, [string, string]>();
  const addKey = (k: [string, string] | null) => k && keys.set(k.join("\0"), k);
  for (const f of files) {
    addKey(changeOf(f.path));
    addKey(changeOf(f.previousPath));
  }
  for (const id of extra) {
    // --spec <id>: an active change the branch implements without touching it.
    const roots = [
      ...new Set(
        [...headFiles]
          .map(changeOf)
          .filter((k) => k && k[1] === id)
          .map((k) => (k as [string, string])[0]),
      ),
    ].sort();
    if (roots[0] !== undefined) addKey([roots[0], id]);
  }
  const changes = [...keys.values()]
    .sort(byKeys((k) => k))
    .map((k) => parseChange(k, files, headFiles, baseFiles, readHead, readBase))
    .filter((c): c is SpecChange => c !== null);
  const deltaIds = new Set(changes.flatMap((c) => c.requirements.map((r) => r.id)));
  const specs = mainSpecEdits(files, readHead, readBase, deltaIds);
  return changes.length || specs.length ? { changes, specs } : null;
}

const LETTER_DELTA: Record<SpecFile["status"], Exclude<Delta, "unchanged">> = {
  A: "added",
  M: "changed",
  R: "changed",
  D: "removed",
};

/**
 * One change: where it lives at the head (its active folder, or its archive folder, moved in this diff or before),
 * or at the base when the diff deletes it; its proposal, design, tasks and requirement deltas.
 */
function parseChange(
  key: [string, string],
  files: SpecFile[],
  headFiles: ReadonlySet<string>,
  baseFiles: ReadonlySet<string>,
  readHead: Read,
  readBase: Read,
): SpecChange | null {
  const [root, id] = key;
  const inChange = (p: string) => {
    const k = changeOf(p);
    return k !== null && k[0] === root && k[1] === id;
  };
  const headPaths = [...headFiles].filter(inChange).sort();
  let sideFiles = headPaths;
  let read = readHead;
  if (!headPaths.length) {
    sideFiles = [...baseFiles].filter(inChange).sort(); // deleted by the diff: read it at the base
    read = readBase;
  }
  const first = sideFiles[0];
  if (first === undefined) return null;
  const m0 = OS_CHANGE.exec(first)?.groups as Record<string, string | undefined>;
  const dir = first.slice(0, first.length - (m0.rest as string).length).replace(/\/+$/, "");
  const archived = Boolean(m0.archive);
  const movedHere = files.some((f) => {
    if (!f.path.startsWith(`${dir}/`)) return false;
    const old = OS_CHANGE.exec(f.previousPath ?? "");
    return Boolean(old && !old.groups?.archive);
  });
  const change: SpecChange = {
    id,
    dir,
    archived,
    deleted: !headPaths.length,
    movedToArchive: archived && movedHere,
    artifacts: [],
    why: "",
    what: [],
    impact: [],
    decisions: [],
    tasks: null,
    requirements: [],
  };
  const status = new Map(files.map((f) => [f.path, f.status]));
  for (const p of sideFiles) {
    const rest = p.slice(dir.length + 1);
    const letter = status.get(p);
    const artifact = (kind: Artifact["kind"], capability: string | null = null): Artifact => ({
      kind,
      path: p,
      delta: letter ? LETTER_DELTA[letter] : "unchanged",
      moved: letter === "R",
      capability,
    });
    const text = read(p) ?? "";
    const spec = /^specs\/([^/]+)\/spec\.md$/.exec(rest);
    if (rest === "proposal.md") {
      Object.assign(change, parseProposal(text));
      change.artifacts.push(artifact("proposal"));
    } else if (rest === "design.md") {
      change.decisions = parseDesign(text);
      change.artifacts.push(artifact("design"));
    } else if (rest === "tasks.md") {
      change.tasks = parseTasks(text);
      change.artifacts.push(artifact("tasks"));
    } else if (spec) {
      change.requirements.push(...parseRequirements(text, spec[1] as string, p, null));
      change.artifacts.push(artifact("spec", spec[1] as string));
    }
  }
  for (const r of change.requirements) r.change = id;
  return change;
}

/** Main specs touched by the diff (archive merges, or direct edits), as requirement-level diffs. */
function mainSpecEdits(files: SpecFile[], readHead: Read, readBase: Read, deltaIds: ReadonlySet<string>) {
  const specs: OpenSpecFacts["specs"] = [];
  for (const f of files) {
    const m = OS_SPEC.exec(f.path);
    if (!m?.groups) continue;
    const capability = m.groups.capability as string;
    const headText = f.status !== "D" ? (readHead(f.path) ?? "") : "";
    const baseText = f.status !== "A" ? (readBase(f.previousPath ?? f.path) ?? "") : "";
    const requirements = diffRequirements(
      parseRequirements(baseText, capability, f.path, "SPEC"),
      parseRequirements(headText, capability, f.path, "SPEC"),
    ).map((r) => ({ ...r, change: null, merged: deltaIds.has(r.id) }));
    specs.push({ capability, path: f.path, delta: LETTER_DELTA[f.status], requirements });
  }
  return specs;
}

/**
 * The requirements a change must account for: every delta of its OpenSpec changes, plus main-spec edits no delta
 * already covers. RENAMED entries carry no behavior and are informational.
 */
export function specRequirements(facts: Pick<Facts, "openspec">): Requirement[] {
  const os = facts.openspec;
  if (!os) return [];
  const out = os.changes.flatMap((c) => c.requirements);
  const seen = new Set(out.map((r) => r.id));
  return [...out, ...os.specs.flatMap((s) => s.requirements).filter((r) => !seen.has(r.id))];
}

/** The requirements the explanation must map to code: ADDED and MODIFIED ones that are not an archive merge. */
export function mappableRequirements(facts: Pick<Facts, "openspec">): Requirement[] {
  return specRequirements(facts).filter((r) => (r.op === "ADDED" || r.op === "MODIFIED") && !r.merged);
}
