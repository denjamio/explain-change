/* explain-change renderer. Pure, deterministic: same data → same DOM/SVG. No dependencies.
   Layout: a canvas (architecture lanes · data flows · data model) driven by a story whose steps move the camera
   and light what changed; below it the SDD (OpenSpec pipeline, requirement × component matrix, scenarios) and the
   design decisions. */
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("ec-data").textContent);
  var ctx = DATA.context, ins = DATA.insight, cfg = ctx.config, src = ctx.source, st = ctx.stats, OS = ctx.openspec;
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var I18N = {
    en: {
      story: "Story", canvas: "Map", architecture: "Architecture", spec: "SDD",
      design: "Design",
      openspec: "OpenSpec",
      local: "Local branch", ado: "Azure DevOps PR", commit: "commit", commits: "commits",
      noInsight: "No story yet", noInsightText: "Ask your agent to run explain-change to write it.",
      staleInsight: "Story out of date", staleText: "The code changed after the story was written. Ask your agent to run explain-change again.",
      invalidInsight: "Story rejected", invalidText: "insight.json has errors:",
      intent: "Goal",
      file: "file", kFiles: "files", kLines: "lines", kComponents: "components", component: "component", kTasks: "tasks", kReqs: "requirements",
      delta: "Changes", after: "After", before: "Before",
      decisions: "Design decisions", brokenRule: "broken rule", brokenRules: "broken rules", lNew: "new", nNew: "new", nChanged: "changed", nRemoved: "removed", lChanged: "changed", lRemoved: "removed", lContext: "untouched", lViolation: "breaks a rule", lSame: "unchanged", lHero: "key dependency",
      refs: "refs", unresolved: "references not resolved", unmapped: "changed files outside the map",
      archEmpty: "No configured component is touched by this change.",

      vsReference: "Compared with the reference flow", extraSteps: "new steps", missingSteps: "steps missing", matchesReference: "matches the reference flow",

      tests: "Tests",
      theme: "Theme", themeAuto: "auto", themeLight: "light", themeDark: "dark",
      alternative: "Alternative", unverified: "The code has no dependency between these components", viaPort: "Linked through {x}: both depend on it",
      unverifiedNote: "No dependency in the code:",
      prev: "Previous", next: "Next", fit: "Fit", zoomIn: "Zoom in", zoomOut: "Zoom out", motion: "Animation",
      resize: "Drag to resize · double-click to reset",
      canvasHint: "Drag to pan · Ctrl/⌘ + wheel to zoom · click a component for details · ← → to step",
      back: "Story", files: "Files", dependsOn: "Depends on", usedBy: "Used by", reqs: "Requirements", symbols: "Public API",
      storyAuto: "Automatic summary.",
      autoOverviewH: "{n} components touched in {m} layers", autoOverviewB: "{f} files, +{a} −{d} lines.",
      autoNewH: "{x} added", autoRemovedH: "{x} removed", autoViolH: "{a} now depends on {b}", autoChangedH: "{x} changed",
      autoChangedB: "{n} file(s), +{a} −{d}.", autoNewB: "New component in {l}.", autoRemovedB: "All its files were deleted.",
      autoSpecH: "{n} requirements in {id}", autoSpecB: "Spec changes included.",
      phaseActive: "active", phaseArchived: "archived", phaseArchiving: "archived by this change",
      proposal: "Proposal", specs: "Specs", designDoc: "Design", tasks: "Tasks", code: "Code", archive: "Archive",
      sAdded: "added", sModified: "edited", sUnchanged: "unchanged", sAbsent: "none", sDeleted: "deleted", pending: "pending",
      implemented: "implemented", partial: "partial", missing: "missing", "n/a": "n/a", notMapped: "not mapped",
      opADDED: "added", opMODIFIED: "modified", opREMOVED: "removed", opRENAMED: "renamed", opSPEC: "spec",
      scenarios: "Scenarios", why: "Why", whatChanges: "What changes", impact: "Impact",
      scenario: "Scenario", showFlow: "Show flow", kGIVEN: "Given", kWHEN: "When", kTHEN: "Then", but: "but",
      status: "Status", seeReqs: "See the requirements", showOnMap: "Show on the map",
      pendingMap: "Requirements not linked to code yet.", mainSpec: "main spec", merged: "merged",
      dataStage: "Data model", stageSteps: "{n} story step(s) here", migrations: "Migrations", fields: "Fields", relations: "Relations", evidence: "Evidence",





      coverageHint: "Share of the changed code that sits in a component on the map.",
      onMap: "on the map", context: "Context",
      noConfig: "No architecture configured", noConfigText: "Layers and components are guessed from folder names. Run explain-change init to define them.",
      decisionsDoc: "Decisions", openTasksN: "{n} open",
      changesTitle: "Changes by component", outsideMap: "Outside the map", testFiles: "Tests",
      leadChanges: "{c} components · {f} files", leadDecisions: "{n} decisions: why it is built this way",
      leadDecision1: "1 decision: why it is built this way", leadSpec: "{n} requirements · {i} implemented"
    },
    es: {
      story: "Historia", canvas: "Mapa", architecture: "Arquitectura", spec: "SDD",
      design: "Diseño",
      openspec: "OpenSpec",
      local: "Rama local", ado: "PR de Azure DevOps", commit: "commit", commits: "commits",
      noInsight: "Sin historia todavía", noInsightText: "Pide a tu agente que ejecute explain-change para escribirla.",
      staleInsight: "Historia desactualizada", staleText: "El código cambió después de escribir la historia. Pide a tu agente que vuelva a ejecutar explain-change.",
      invalidInsight: "Historia rechazada", invalidText: "insight.json tiene errores:",
      intent: "Objetivo",
      file: "archivo", kFiles: "archivos", kLines: "líneas", kComponents: "componentes", component: "componente", kTasks: "tareas", kReqs: "requisitos",
      delta: "Cambios", after: "Después", before: "Antes",
      decisions: "Decisiones de diseño", brokenRule: "regla rota", brokenRules: "reglas rotas", lNew: "nuevo", nNew: "nuevos", nChanged: "cambiados", nRemoved: "eliminados", lChanged: "cambiado", lRemoved: "eliminado", lContext: "sin tocar", lViolation: "rompe una regla", lSame: "sin cambios", lHero: "dependencia clave",
      refs: "refs", unresolved: "referencias sin resolver", unmapped: "archivos cambiados fuera del mapa",
      archEmpty: "Este cambio no toca ningún componente configurado.",

      vsReference: "Frente al flujo de referencia", extraSteps: "pasos nuevos", missingSteps: "pasos que faltan", matchesReference: "coincide con el flujo de referencia",

      tests: "Tests",
      theme: "Tema", themeAuto: "auto", themeLight: "claro", themeDark: "oscuro",
      alternative: "Alternativa", unverified: "El código no tiene dependencia entre estos componentes", viaPort: "Conectados a través de {x}: ambos dependen de él",
      unverifiedNote: "Sin dependencia en el código:",
      prev: "Anterior", next: "Siguiente", fit: "Ajustar", zoomIn: "Acercar", zoomOut: "Alejar", motion: "Animación",
      resize: "Arrastra para cambiar el alto · doble clic para restaurar",
      canvasHint: "Arrastra para mover · Ctrl/⌘ + rueda para zoom · clic en un componente para ver detalle · ← → para avanzar",
      back: "Historia", files: "Archivos", dependsOn: "Depende de", usedBy: "Usado por", reqs: "Requisitos", symbols: "API pública",
      storyAuto: "Resumen automático.",
      autoOverviewH: "{n} componentes tocados en {m} capas", autoOverviewB: "{f} archivos, +{a} −{d} líneas.",
      autoNewH: "{x} añadido", autoRemovedH: "{x} eliminado", autoViolH: "{a} ahora depende de {b}", autoChangedH: "{x} cambia",
      autoChangedB: "{n} archivo(s), +{a} −{d}.", autoNewB: "Componente nuevo en {l}.", autoRemovedB: "Se borraron todos sus archivos.",
      autoSpecH: "{n} requisitos en {id}", autoSpecB: "Cambios de spec incluidos.",
      phaseActive: "activo", phaseArchived: "archivado", phaseArchiving: "archivado en este cambio",
      proposal: "Propuesta", specs: "Specs", designDoc: "Diseño", tasks: "Tareas", code: "Código", archive: "Archivo",
      sAdded: "añadido", sModified: "editado", sUnchanged: "sin cambios", sAbsent: "no hay", sDeleted: "eliminado", pending: "pendiente",
      implemented: "implementado", partial: "parcial", missing: "falta", "n/a": "n/a", notMapped: "sin mapear",
      opADDED: "añadido", opMODIFIED: "modificado", opREMOVED: "eliminado", opRENAMED: "renombrado", opSPEC: "spec",
      scenarios: "Escenarios", why: "Por qué", whatChanges: "Qué cambia", impact: "Impacto",
      scenario: "Escenario", showFlow: "Ver flujo", kGIVEN: "Dado", kWHEN: "Cuando", kTHEN: "Entonces", but: "pero",
      status: "Estado", seeReqs: "Ver los requisitos", showOnMap: "Ver en el mapa",
      pendingMap: "Requisitos aún sin enlazar al código.", mainSpec: "spec principal", merged: "fusionado",
      dataStage: "Modelo de datos", stageSteps: "{n} paso(s) de la historia aquí", migrations: "Migraciones", fields: "Campos", relations: "Relaciones", evidence: "Evidencia",





      coverageHint: "Parte del código cambiado que está en un componente del mapa.",
      onMap: "en el mapa", context: "Contexto",
      noConfig: "Sin arquitectura configurada", noConfigText: "Capas y componentes deducidos de los nombres de carpetas. Ejecuta explain-change init para definirlos.",
      decisionsDoc: "Decisiones", openTasksN: "{n} abiertas",
      changesTitle: "Cambios por componente", outsideMap: "Fuera del mapa", testFiles: "Tests",
      leadChanges: "{c} componentes · {f} archivos", leadDecisions: "{n} decisiones: por qué está construido así",
      leadDecision1: "1 decisión: por qué está construido así", leadSpec: "{n} requisitos · {i} implementados"
    }
  };
  var T = I18N[cfg.lang] || I18N.en;
  function tf(key, o) { return T[key].replace(/\{(\w+)\}/g, function (_, k) { return o[k] !== undefined ? o[k] : ""; }); }

  // ── helpers ──
  var SVGNS = "http://www.w3.org/2000/svg";
  function h(tag, attrs) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    setAttrs(el, attrs);
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.setAttribute("class", v);
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) return child.forEach(function (c) { append(el, c); });
    el.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }
  function fmt(n) { return Number(n).toLocaleString(cfg.lang === "es" ? "es-ES" : "en-US"); }
  function trunc(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
  // Shortens a label to the pixels it has (character counts misjudge wide letters and bold faces).
  var measure = document.createElement("canvas").getContext("2d");
  function fit(t, font, maxW) {
    t = String(t || "");
    if (!measure) return t;
    measure.font = font + " " + getComputedStyle(document.body).fontFamily;
    if (measure.measureText(t).width <= maxW) return t;
    while (t.length > 1 && measure.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function r1(n) { return Math.round(n * 10) / 10; }

  var compById = {}, layerRank = {}, compRank = {};
  cfg.layers.forEach(function (l, i) { layerRank[l.id] = i; });
  cfg.components.forEach(function (c, i) { compById[c.id] = c; compRank[c.id] = [layerRank[c.layer], i]; });
  function byCompRank(a, b) {
    var ra = compRank[a] || [99, 999], rb = compRank[b] || [99, 999];
    return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
  }
  var changeComp = {};
  ctx.components.forEach(function (c) { changeComp[c.id] = c; });
  var fileIndex = {};
  ctx.files.forEach(function (f, i) { fileIndex[f.path] = i; });
  var summaryOf = {};
  if (ins) ins.changes.forEach(function (c) { summaryOf[c.id] = c.summary; });
  function compName(id) { return (compById[id] && compById[id].name) || id; }
  function layerName(id) { var c = compById[id]; return c ? (cfg.layers[layerRank[c.layer]] || {}).name || c.layer : ""; }
  function statusLabel(stt) { return T["l" + cap(stt)] || stt; }

  // OpenSpec: requirement list (deltas of the change, then main-spec edits not covered by a delta), and the agent's map.
  var REQS = [], reqById = {};
  if (OS) {
    OS.changes.forEach(function (c) { c.requirements.forEach(function (r) { REQS.push(r); }); });
    var seenReq = {};
    REQS.forEach(function (r) { seenReq[r.id] = true; });
    OS.specs.forEach(function (sp) { sp.requirements.forEach(function (r) { if (!seenReq[r.id]) REQS.push(r); }); });
    REQS.forEach(function (r) { reqById[r.id] = r; });
  }
  var specMap = {};
  if (ins && ins.spec) ins.spec.forEach(function (m) { specMap[m.req] = m; });
  function reqsOfComp(id) { return REQS.filter(function (r) { var m = specMap[r.id]; return m && m.components.indexOf(id) > -1; }); }
  // Requirement ids → the components that implement them; component ids pass through.
  function specComponents(ids) {
    var out = [];
    ids.forEach(function (id) {
      var comps = reqById[id] ? (specMap[id] || { components: [] }).components : compById[id] ? [id] : [];
      comps.forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
    });
    return out;
  }
  // implemented | partial | missing | n/a from the agent; pending = no map yet; none = removed or renamed, not mapped.
  function reqStatus(r) {
    var m = specMap[r.id];
    if (m) return m.status;
    return (ins && ins.spec && ins.spec.length) || r.op === "REMOVED" || r.op === "RENAMED" ? "none" : "pending";
  }
  var RS_ICON = { implemented: "✓", partial: "◐", missing: "✗", "n/a": "–", pending: "…", none: "–" };
  function rsLabel(stt) { return stt === "pending" ? T.notMapped : stt === "none" ? "—" : T[stt] || stt; }

  // A file reference links to that file in the PR when the source has one; otherwise it is plain text.
  function prFileUrl(path) {
    return src.mode === "ado" && src.url ? src.url + "?_a=files&path=" + encodeURIComponent("/" + path) : null;
  }
  function onOpen(el, path) {
    var url = prFileUrl(path);
    if (url) { el.classList.add("linked"); el.addEventListener("click", function () { window.open(url, "_blank", "noopener"); }); }
    return el;
  }
  function fileLink(ref, label) {
    var path = (/^(.+?):\d+/.exec(ref || "") || [null, ref])[1], url = prFileUrl(path);
    return url ? h("a", { href: url, target: "_blank", rel: "noopener", class: "ref", text: label || ref })
      : h("code", { class: "ref", text: label || ref });
  }
  // A section: its title, one line with its figures, then the body.
  function sectionShell(id, title, body, lead) {
    return h("section", { class: "section", id: id },
      h("div", { class: "section-head" }, h("h2", { text: title }), lead ? h("span", { class: "section-lead", text: lead }) : null), body);
  }
  function legendItem(kind, color, label) {
    if (kind === "swatch") return h("span", null, h("i", { class: "swatch", style: "background:" + color }), label);
    return h("span", null, h("i", { class: "legend-line" + (kind.indexOf("anim") > -1 ? " anim" : ""), style: "border-top-color:" + color + (kind.indexOf("dashed") > -1 ? ";border-top-style:dashed" : "") }), label);
  }

  // ═════════════════════════════ header ═════════════════════════════
  function renderHeader() {
    var notice = ins ? null : h("div", { class: "notice" },
      h("span", { class: "notice-icon", text: "i" }),
      h("div", null,
        h("b", { text: { stale: T.staleInsight, invalid: T.invalidInsight }[DATA.insightStatus] || T.noInsight }), " ",
        { stale: T.staleText, invalid: T.invalidText }[DATA.insightStatus] || T.noInsightText,
        DATA.insightStatus === "invalid" ? h("ul", null, DATA.insightErrors.map(function (e) { return h("li", { text: e }); })) : null));
    var counts = { new: 0, changed: 0, removed: 0 };
    ctx.components.forEach(function (c) { if (counts[c.status] !== undefined) counts[c.status]++; });
    var srcLabel = src.mode === "ado" ? T.ado + " #" + src.pr_id : T.local;
    var coverage = st.code_lines ? Math.round(100 * (st.mapped_lines || 0) / st.code_lines) : 100;
    // One chip per question: how big (files, lines), what moved (components), is the spec met, what to check.
    function part(v, label, cls) { return [h("b", { class: cls || "", text: String(v) }), h("span", { text: label })]; }
    function group(parts, title, href) {
      var el = h(href ? "a" : "span", { class: "stat-chip", title: title || null, href: href || null });
      parts.filter(Boolean).forEach(function (pt, i) { if (i) el.appendChild(h("span", { class: "sep", text: "·" })); append(el, pt); });
      return el;
    }
    var moved = [counts.new ? part(counts.new, counts.new === 1 ? T.lNew : T.nNew, "new") : null,
      counts.changed ? part(counts.changed, counts.changed === 1 ? T.lChanged : T.nChanged, "changed") : null,
      counts.removed ? part(counts.removed, counts.removed === 1 ? T.lRemoved : T.nRemoved, "removed") : null].filter(Boolean);
    var chips = [
      group([part(fmt(st.files), st.files === 1 ? T.file : T.kFiles),
        [h("b", null, h("span", { class: "add", text: "+" + fmt(st.add) }), " ", h("span", { class: "del", text: "−" + fmt(st.del) })), h("span", { text: T.kLines })]]),
      moved.length ? group(moved) : null,
      coverage < 100 ? h("span", { class: "stat-chip", title: T.coverageHint }, h("b", { text: coverage + "%" }), h("span", { text: T.onMap })) : null,
      st.violations_new ? chip(st.violations_new, st.violations_new === 1 ? T.brokenRule : T.brokenRules, "violation") : null];
    if (OS) {
      var tdone = 0, ttotal = 0;
      OS.changes.forEach(function (c) { if (c.tasks) { tdone += c.tasks.done; ttotal += c.tasks.total; } });
      var spec = [REQS.length ? part(REQS.length, T.kReqs, "accent") : null,
        ttotal ? part(tdone + "/" + ttotal, T.kTasks, tdone === ttotal ? "ok" : "warn") : null].filter(Boolean);
      if (spec.length) chips.push(group(spec, null, "#sdd"));
    }
    return h("header", { class: "hero", id: "summary" },
      cfg.inferred ? h("div", { class: "config-warn", role: "note" },
        h("span", { class: "config-warn-icon", text: "!" }),
        h("div", null, h("b", { text: T.noConfig }), " ", h("span", { text: T.noConfigText }))) : null,
      h("div", { class: "eyebrow" },
        h("span", { text: cfg.name }), h("span", { class: "faint", text: "·" }),
        src.url ? h("a", { href: src.url, text: srcLabel }) : h("span", { text: srcLabel }),
        h("span", { class: "faint", text: "·" }),
        h("span", null, h("code", { text: src.branch }), " → ", h("code", { text: src.base_ref })),
        h("span", { class: "faint", text: src.commits + " " + (src.commits === 1 ? T.commit : T.commits) + (src.head_date ? " · " + src.head_date.slice(0, 10) : "") })),
      h("h1", { class: "title", text: src.title }),
      ins ? h("p", { class: "intent" }, h("b", { text: T.intent }), ins.intent) : null,
      ins ? h("p", { class: "tldr", text: ins.tldr }) : null,
      notice,
      h("div", { class: "chips" }, chips),
      ctx.notes.map(function (n) { return h("p", { class: "note faint", text: n }); }));
  }
  function chip(v, label, cls) {
    return h("span", { class: "stat-chip " + (cls || "") }, h("b", { text: String(v) }), h("span", { text: label }));
  }

  // ═════════════════════════════ stages ═════════════════════════════
  // Every stage draws into one SVG and registers its focusable elements: geo[key] (box), data-k on the element,
  // and edges carrying data-a / data-b. `expand(set)` says what else lights up with a focus set.

  function newStage(id, W, H) {
    var svg = s("svg", { class: "stage-svg stage-" + id.split(":")[0], role: "img", preserveAspectRatio: "xMidYMid meet" });
    return { id: id, svg: svg, W: W, H: H, geo: {}, keyOf: function (x) { return x; }, expand: function (set) { return set; } };
  }
  function markers(svg, prefix, kinds) {
    var defs = s("defs");
    kinds.forEach(function (k) {
      defs.appendChild(s("marker", { id: prefix + k, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "10", markerHeight: "10", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" },
        s("path", { d: "M0,0 L10,5 L0,10 z", class: "arrow arrow-" + k })));
    });
    svg.appendChild(defs);
  }

  // ── Architecture: lanes (layers, top = entry), components ordered to cut crossings ──
  var heroPairs = {};
  if (ins) ins.hero.forEach(function (x) { heroPairs[x.from + ">" + x.to] = x.label || ""; });

  function layoutArch(nodes, edges, compact) {
    var W = compact ? 380 : 1160;
    var LABEL = compact ? 0 : 156, NW = compact ? 168 : 200, NH = 66, GX = compact ? 12 : 34, GY = 22, PADY = 24, TOPL = compact ? 30 : 0;
    var perRow = Math.max(1, Math.floor((W - LABEL - 24 + GX) / (NW + GX)));
    var layers = cfg.layers.filter(function (l) { return nodes.some(function (n) { return compById[n.id].layer === l.id; }); });
    var byLayer = {}, idx = {}, adj = {};
    layers.forEach(function (l) {
      byLayer[l.id] = nodes.filter(function (n) { return compById[n.id].layer === l.id; }).sort(function (a, b) {
        return ((a.status === "context") - (b.status === "context")) || byCompRank(a.id, b.id);
      });
    });
    edges.forEach(function (e) { (adj[e.from] = adj[e.from] || []).push(e.to); (adj[e.to] = adj[e.to] || []).push(e.from); });
    function reindex(l) { var arr = byLayer[l.id]; arr.forEach(function (n, i) { idx[n.id] = (i + 0.5) / arr.length; }); }
    layers.forEach(reindex);
    // Barycenter sweeps (down, up, down, up): each lane is reordered by the mean position of its neighbours in other lanes.
    for (var it = 0; it < 4; it++) {
      (it % 2 ? layers.slice().reverse() : layers).forEach(function (l) {
        var bc = {};
        byLayer[l.id].forEach(function (n) {
          var nb = (adj[n.id] || []).filter(function (x) { return idx[x] !== undefined && compById[x].layer !== l.id; });
          bc[n.id] = nb.length ? nb.reduce(function (a, x) { return a + idx[x]; }, 0) / nb.length : idx[n.id];
        });
        byLayer[l.id].sort(function (a, b) { return (bc[a.id] - bc[b.id]) || byCompRank(a.id, b.id); });
        reindex(l);
      });
    }
    var bands = [], pos = {}, y = 0;
    layers.forEach(function (layer) {
      var inLayer = byLayer[layer.id];
      var rows = Math.ceil(inLayer.length / perRow);
      var ids = inLayer.map(function (n) { return n.id; });
      var ARC = edges.some(function (e) { return ids.indexOf(e.from) > -1 && ids.indexOf(e.to) > -1; }) ? 40 : 0;
      var top = TOPL + ARC;
      var bh = rows * NH + (rows - 1) * GY + PADY * 2 + top;
      bands.push({ layer: layer, y: y, h: bh, n: inLayer.length });
      inLayer.forEach(function (n, i) {
        var row = Math.floor(i / perRow), col = i % perRow;
        var inRow = Math.min(perRow, inLayer.length - row * perRow);
        var rowW = inRow * NW + (inRow - 1) * GX;
        var x0 = LABEL + (W - LABEL - rowW) / 2;
        pos[n.id] = { x: x0 + col * (NW + GX), y: y + top + PADY + row * (NH + GY), w: NW, h: NH };
      });
      y += bh + 12;
    });
    return { W: W, H: Math.max(y - 12, 60), bands: bands, pos: pos, compact: compact, GX: GX };
  }

  function edgePaths(edges, pos, L) {
    // Port allocation: spread attachment points along each node side, ordered by the other end's x.
    var ports = {};
    function addPort(node, side, edgeKey, otherX) {
      var k = node + "|" + side;
      (ports[k] = ports[k] || []).push({ key: edgeKey, x: otherX });
    }
    var geo = edges.map(function (e) {
      var a = pos[e.from], b = pos[e.to];
      var down = b.y > a.y + 1, up = b.y + 1 < a.y;
      var g = { e: e, key: e.from + ">" + e.to, a: a, b: b };
      if (down) { g.sa = "bottom"; g.sb = "top"; }
      else if (up) { g.sa = "top"; g.sb = "bottom"; }
      else { g.sa = "top"; g.sb = "top"; }
      addPort(e.from, g.sa, g.key, b.x);
      addPort(e.to, g.sb, g.key, a.x);
      return g;
    });
    function portX(node, side, key) {
      var list = ports[node + "|" + side].slice().sort(function (p, q) { return p.x - q.x || (p.key < q.key ? -1 : 1); });
      var i = list.findIndex(function (p) { return p.key === key; });
      var r = pos[node];
      return r.x + r.w * (i + 1) / (list.length + 1);
    }
    // Nodes lying between both ends block a direct curve; such edges detour through the gap beside them.
    function obstacles(g, x1, x2, yTop, yBot) {
      var lo = Math.min(x1, x2) - 8, hi = Math.max(x1, x2) + 8;
      return Object.keys(pos).filter(function (id) {
        if (id === g.e.from || id === g.e.to) return false;
        var r = pos[id];
        return r.y < yBot && r.y + r.h > yTop && r.x < hi && r.x + r.w > lo;
      }).map(function (id) { return pos[id]; });
    }
    var laneUse = {};
    return geo.map(function (g) {
      var x1 = portX(g.e.from, g.sa, g.key), x2 = portX(g.e.to, g.sb, g.key);
      var y1 = g.sa === "bottom" ? g.a.y + g.a.h : g.a.y, y2 = g.sb === "top" ? g.b.y - 4 : g.b.y + g.b.h + 4;
      var d;
      if (g.sa === "top" && g.sb === "top") {
        var lift = Math.min(34, 22 + Math.abs(x2 - x1) / 10);
        d = "M" + r1(x1) + "," + y1 + " C" + r1(x1) + "," + r1(y1 - lift) + " " + r1(x2) + "," + r1(y2 - lift) + " " + r1(x2) + "," + y2;
        return { e: g.e, d: d, mx: (x1 + x2) / 2, my: Math.min(y1, y2) - lift * 0.75 };
      }
      var dir = y2 > y1 ? 1 : -1;
      var blockers = obstacles(g, x1, x2, Math.min(y1, y2), Math.max(y1, y2));
      if (!blockers.length) {
        var my = (y1 + y2) / 2;
        d = "M" + r1(x1) + "," + y1 + " C" + r1(x1) + "," + r1(my) + " " + r1(x2) + "," + r1(my) + " " + r1(x2) + "," + y2;
        return { e: g.e, d: d, mx: (x1 + x2) / 2, my: my };
      }
      var gap = (L.GX || 20) / 2, mid = (x1 + x2) / 2, yTop = Math.min(y1, y2), yBot = Math.max(y1, y2);
      var lane, right, left;
      // Grow the blocker set until the chosen lane is clear of every node between both ends.
      for (var guard = 0; guard < 12; guard++) {
        right = Math.max.apply(null, blockers.map(function (r) { return r.x + r.w; })) + gap;
        left = Math.min.apply(null, blockers.map(function (r) { return r.x; })) - gap;
        lane = (Math.abs(right - mid) <= Math.abs(left - mid) && right < L.W - 4) || left < 4 ? right : left;
        var hit = obstacles(g, lane, lane, yTop, yBot).filter(function (r) { return blockers.indexOf(r) < 0; });
        if (!hit.length) break;
        blockers = blockers.concat(hit);
      }
      var used = laneUse[Math.round(lane)] = (laneUse[Math.round(lane)] || 0) + 1;
      lane += (lane === right ? 1 : -1) * (used - 1) * 4;
      var ra = y1 + dir * 26, rb = y2 - dir * 26;
      d = "M" + r1(x1) + "," + y1 + " C" + r1(x1) + "," + (y1 + dir * 18) + " " + r1(lane) + "," + (y1 + dir * 8) + " " + r1(lane) + "," + ra +
        " L" + r1(lane) + "," + rb + " C" + r1(lane) + "," + (y2 - dir * 8) + " " + r1(x2) + "," + (y2 - dir * 18) + " " + r1(x2) + "," + y2;
      return { e: g.e, d: d, mx: lane, my: (y1 + y2) / 2 };
    });
  }

  function buildArchitecture(mode, compact, onNode) {
    var nodes = ctx.components.filter(function (n) {
      return !(mode === "before" && n.status === "new") && !(mode === "after" && n.status === "removed");
    });
    var vis = {};
    nodes.forEach(function (n) { vis[n.id] = true; });
    var edges = ctx.edges.filter(function (e) {
      if (!vis[e.from] || !vis[e.to]) return false;
      if (mode === "before") return e.status !== "new";
      if (mode === "after") return e.status !== "removed";
      return true;
    });
    var L = layoutArch(nodes, edges, compact);
    var S = newStage("architecture", L.W, L.H);
    var svg = S.svg;
    svg.classList.add("mode-" + mode);
    if (!nodes.length) { S.empty = T.archEmpty; return S; }
    markers(svg, "ar-", ["same", "new", "removed", "violation", "hero"]);
    L.bands.forEach(function (b) {
      svg.appendChild(s("rect", { x: 0, y: b.y, width: L.W, height: b.h, rx: 14, class: "band" }));
      if (L.compact) svg.appendChild(s("text", { x: 14, y: b.y + 20, class: "band-label", text: trunc(b.layer.name, 40) }));
      else {
        svg.appendChild(s("text", { x: 18, y: b.y + b.h / 2 - 2, class: "band-label", text: trunc(b.layer.name, 18) }));
        svg.appendChild(s("text", { x: 18, y: b.y + b.h / 2 + 14, class: "band-sub", text: b.n + " " + (b.n === 1 ? T.component : T.kComponents) }));
      }
    });
    var edgeLayer = s("g", { class: "edges" }), labelLayer = s("g", { class: "edge-labels" });
    edgePaths(edges, L.pos, L).forEach(function (p, i) {
      var e = p.e, k = e.violation ? "violation" : e.status;
      var hero = heroPairs[e.from + ">" + e.to] !== undefined;
      var tip = compName(e.from) + " → " + compName(e.to) + " · " + (e.head_count || e.base_count) + " " + T.refs +
        (e.refs[0] ? " · " + e.refs[0] : "") + (e.violation ? " · ⚠ " + e.violation.rule : "");
      var pid = "ep-" + i;
      var g = s("g", { class: "edge-g" + (hero ? " hero" : ""), "data-k": "e:" + e.from + ">" + e.to, "data-a": e.from, "data-b": e.to },
        s("title", { text: tip }),
        s("path", { d: p.d, class: "edge-hit" }),
        hero ? s("path", { d: p.d, class: "edge-glow" }) : null,
        s("path", { id: pid, d: p.d, class: "edge e-" + k + (e.violation && e.violation.existing ? " existing" : ""), "marker-end": "url(#ar-" + (hero && !e.violation ? "hero" : k) + ")" }));
      if ((hero || e.status === "new") && e.status !== "removed") {
        // A dot travels the dependency: the change's new paths and its key one read as live.
        g.appendChild(s("circle", { r: hero ? 4.5 : 3, class: "pulse" + (hero ? " hero" : "") },
          s("animateMotion", { dur: hero ? "2.2s" : "3s", repeatCount: "indefinite", begin: "-" + r1((i % 5) * 0.4) + "s" }, s("mpath", { href: "#" + pid }))));
      }
      edgeLayer.appendChild(g);
      if (hero && heroPairs[e.from + ">" + e.to]) {
        var label = trunc(heroPairs[e.from + ">" + e.to], 40), lw = label.length * 6.4 + 16;
        labelLayer.appendChild(s("g", { class: "edge-label", "data-a": e.from, "data-b": e.to },
          s("rect", { x: r1(p.mx - lw / 2), y: r1(p.my - 11), width: r1(lw), height: 22, rx: 11 }),
          s("text", { x: r1(p.mx), y: r1(p.my + 4), "text-anchor": "middle", text: label })));
      }
    });
    svg.appendChild(edgeLayer);
    nodes.forEach(function (n) {
      var r = L.pos[n.id], c = compById[n.id];
      S.geo[n.id] = r;
      var nreq = reqsOfComp(n.id).length;
      var info = n.status === "context" ? T.lContext : n.files + " " + (n.files === 1 ? T.file : T.kFiles) + (nreq ? " · ◆ " + nreq : "");
      var g = s("g", { class: "node st-" + n.status, "data-k": n.id, tabindex: "0", role: "button",
        "aria-label": c.name + ", " + statusLabel(n.status) },
        s("title", { text: c.name + (summaryOf[n.id] ? "\n" + summaryOf[n.id] : c.desc ? "\n" + c.desc : "") }),
        s("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 12, class: "box" }),
        s("text", { x: r.x + 14, y: r.y + 19, class: "tag", text: n.status === "context" ? "" : statusLabel(n.status).toUpperCase() }),
        n.status !== "context" ? s("text", { x: r.x + r.w - 12, y: r.y + 19, "text-anchor": "end", class: "delta" },
          s("tspan", { class: "add", text: "+" + n.add }), s("tspan", { class: "del", text: " −" + n.del })) : null,
        s("text", { x: r.x + 14, y: r.y + 39, class: "name", text: fit(c.name, compact ? "650 13px" : "650 14px", r.w - 28) }),
        s("text", { x: r.x + 14, y: r.y + 56, class: "info", text: info }));
      if (onNode) onNode(g, n.id);
      svg.appendChild(g);
    });
    svg.appendChild(labelLayer);
    S.expand = function (set) {
      var keys = Object.keys(set);
      if (keys.length === 1 && vis[keys[0]]) {
        edges.forEach(function (e) { if (e.from === keys[0]) set[e.to] = true; if (e.to === keys[0]) set[e.from] = true; });
      }
      return set;
    };
    S.focusBoxKeys = function (ids) { return ids.filter(function (x) { return vis[x]; }); };
    return S;
  }

  // ── Data flow: sequence over real components, steps travel in order ──
  function buildFlow(fl) {
    var parts = [];
    fl.steps.forEach(function (x) { [x.from, x.to].forEach(function (p) { if (parts.indexOf(p) < 0) parts.push(p); }); });
    parts.sort(byCompRank);
    var hasData = fl.steps.some(function (x) { return x.data; });
    var COL = 220, HEAD = 58, ROW = hasData ? 66 : 50, TOP = 20;
    var W = Math.max(720, parts.length * COL + 40), H = TOP + HEAD + 26 + fl.steps.length * ROW + 16;
    var S = newStage("flow:" + fl.id, W, H);
    var svg = S.svg, x = {};
    var offset = (W - parts.length * COL) / 2;
    parts.forEach(function (p, i) { x[p] = offset + i * COL + COL / 2; });
    markers(svg, "sq-" + fl.id + "-", ["same", "new", "changed", "removed"]);
    parts.forEach(function (p) {
      var c = compById[p], cc = changeComp[p];
      var stt = cc ? cc.status : "context";
      var box = { x: x[p] - COL / 2 + 12, y: TOP, w: COL - 24, h: HEAD - 8 };
      S.geo["p:" + p] = box;
      svg.appendChild(s("line", { x1: x[p], y1: TOP + HEAD - 8, x2: x[p], y2: H - 8, class: "lifeline", "data-a": "p:" + p, "data-b": "p:" + p }));
      svg.appendChild(s("g", { class: "head st-" + stt, "data-k": "p:" + p },
        s("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 11 }),
        s("text", { x: x[p], y: TOP + 21, "text-anchor": "middle", class: "name", text: trunc(c ? c.name : p, 21) }),
        s("text", { x: x[p], y: TOP + 37, "text-anchor": "middle", class: "layer", text: trunc(layerName(p), 24) })));
    });
    var n = fl.steps.length, per = 0.9, total = n * per + 1.2;
    fl.steps.forEach(function (stp, i) {
      var y = TOP + HEAD + 30 + i * ROW, x1 = x[stp.from], x2 = x[stp.to];
      var key = "#" + (i + 1);
      var g = s("g", { class: "msg st-" + stp.status + (stp.verified === false ? " unverified" : ""), "data-k": key, "data-from": "p:" + stp.from, "data-to": "p:" + stp.to });
      if (stp.verified === false) g.appendChild(s("title", { text: T.unverified }));
      else if (stp.via) g.appendChild(s("title", { text: tf("viaPort", { x: compName(stp.via) }) }));
      var marker = "url(#sq-" + fl.id + "-" + stp.status + ")", pid = "fm-" + fl.id + "-" + i, d;
      g.appendChild(s("rect", { x: Math.min(x1, x2) - 14, y: y - 24, width: Math.max(Math.abs(x2 - x1), 60) + 28, height: 36, rx: 8, class: "msg-bg" }));
      if (stp.from === stp.to) {
        d = "M" + x1 + "," + (y - 6) + " h38 v16 h-34";
        g.appendChild(s("path", { id: pid, d: d, class: "msg-line", "marker-end": marker }));
        g.appendChild(s("text", { x: x1 + 46, y: y + 4, class: "msg-label", text: trunc(stp.msg, 40) }));
        S.geo[key] = { x: x1 - 10, y: y - 24, w: 220, h: 36 };
      } else {
        var dir = x2 > x1 ? 1 : -1;
        d = "M" + (x1 + dir * 4) + "," + y + " L" + (x2 - dir * 6) + "," + y;
        g.appendChild(s("path", { id: pid, d: d, class: "msg-line", "marker-end": marker }));
        g.appendChild(s("text", { x: (x1 + x2) / 2, y: y - 8, "text-anchor": "middle", class: "msg-label", text: stp.msg + (stp.verified === false ? "  ?" : "") }));
        if (stp.data) g.appendChild(dataChip(stp.data, (x1 + x2) / 2, y + 17));
        S.geo[key] = { x: Math.min(x1, x2), y: y - 24, w: Math.abs(x2 - x1), h: 36 };
      }
      g.appendChild(s("g", { class: "step-badge" }, s("circle", { cx: x1 - dir1(x1, x2) * 16, cy: y, r: 9 }),
        s("text", { x: x1 - dir1(x1, x2) * 16, y: y + 3.5, "text-anchor": "middle", text: String(i + 1) })));
      if (stp.status !== "removed") {
        // One dot per step, each starting when the previous one lands: the sequence plays in call order, then loops.
        var a = r1(i * per / total), b = r1((i * per + per * 0.8) / total);
        g.appendChild(s("circle", { r: 4, class: "pulse", opacity: "0" },
          s("animateMotion", { dur: r1(total) + "s", repeatCount: "indefinite", calcMode: "linear", keyPoints: "0;0;1;1", keyTimes: "0;" + a + ";" + b + ";1" }, s("mpath", { href: "#" + pid })),
          s("animate", { attributeName: "opacity", dur: r1(total) + "s", repeatCount: "indefinite", calcMode: "discrete", values: "0;1;0", keyTimes: "0;" + a + ";" + b })));
      }
      svg.appendChild(g);
    });
    S.keyOf = function (id) { return /^#\d+$/.test(id) ? id : "p:" + id; };
    S.expand = function (set) {
      var msgs = Object.keys(set).filter(function (k) { return k.charAt(0) === "#"; });
      var heads = Object.keys(set).filter(function (k) { return k.slice(0, 2) === "p:"; });
      fl.steps.forEach(function (stp, i) {
        var k = "#" + (i + 1);
        if (!msgs.length && (set["p:" + stp.from] || set["p:" + stp.to]) && heads.length) set[k] = true;
      });
      fl.steps.forEach(function (stp, i) { if (set["#" + (i + 1)]) { set["p:" + stp.from] = true; set["p:" + stp.to] = true; } });
      return set;
    };
    return S;
  }
  // What travels on a step: "Order { +email ~total −fax }", coloured per field change.
  function dataChip(data, cx, y) {
    var shown = (data.fields || []).filter(function (f) { return fieldKind(f) !== "same"; });
    if (!shown.length) shown = (data.fields || []).slice(0, 3);
    var parts = [{ t: data.type, k: "type" }].concat(shown.length ? [{ t: " {", k: "p" }] : [])
      .concat(shown.slice(0, 4).map(function (f, i) { var k = fieldKind(f); return { t: (i ? "  " : " ") + { add: "+", del: "−", mod: "~", same: "" }[k] + fieldText(f).split(":")[0].trim(), k: k }; }))
      .concat(shown.length > 4 ? [{ t: " …", k: "p" }] : []).concat(shown.length ? [{ t: " }", k: "p" }] : []);
    var len = parts.reduce(function (a, p) { return a + p.t.length; }, 0), w = len * 6.6 + 20;
    var g = s("g", { class: "data-chip" }, s("title", { text: data.type + "\n" + (data.fields || []).join("\n") }),
      s("rect", { x: r1(cx - w / 2), y: y - 13, width: r1(w), height: 20, rx: 6 }));
    var t = s("text", { x: r1(cx), y: y + 1, "text-anchor": "middle" });
    parts.forEach(function (p) { t.appendChild(s("tspan", { class: "dk-" + p.k, text: p.t })); });
    g.appendChild(t);
    return g;
  }
  function dir1(x1, x2) { return x2 >= x1 ? 1 : -1; }

  // ── Data: the entities the change touches (agent, with evidence) and the migrations in the diff (computed) ──
  var DM = ins && ins.data_model && ins.data_model.entities.length ? ins.data_model : null;
  var entById = {};
  if (DM) DM.entities.forEach(function (e) { entById[e.id] = e; });
  function fieldKind(f) { var c = f.trim().charAt(0); return c === "+" ? "add" : c === "-" || c === "−" ? "del" : c === "~" ? "mod" : "same"; }
  function fieldText(f) { return /^[+\-−~]/.test(f.trim()) ? f.trim().slice(1).trim() : f.trim(); }

  function buildData(onNode) {
    var EW = 250, GX = 90, GY = 70, PER = 3;
    var order = { added: 0, changed: 1, removed: 2, same: 3 };
    var ents = DM.entities.slice().sort(function (a, b) {
      return order[a.change] - order[b.change] || byCompRank(a.component || "", b.component || "") || (a.name < b.name ? -1 : 1);
    });
    var migrations = ctx.files.filter(function (f) { return f.category === "migration"; });
    var top = migrations.length ? 34 + Math.min(migrations.length, 4) * 20 + 30 : 10;
    var heights = ents.map(function (e) { return 52 + Math.max(1, e.fields.length) * 19 + 10; });
    var rows = Math.ceil(ents.length / PER), rowH = [];
    for (var r = 0; r < rows; r++) rowH.push(Math.max.apply(null, heights.slice(r * PER, r * PER + PER)));
    var cols = Math.min(PER, ents.length), W = Math.max(cols * EW + (cols - 1) * GX, 600);
    var pos = {}, y = top;
    ents.forEach(function (e, i) {
      var r = Math.floor(i / PER), c = i % PER, inRow = Math.min(PER, ents.length - r * PER);
      var x0 = (W - (inRow * EW + (inRow - 1) * GX)) / 2;
      var ry = top + rowH.slice(0, r).reduce(function (a, v) { return a + v + GY; }, 0);
      pos[e.id] = { x: x0 + c * (EW + GX), y: ry, w: EW, h: heights[i] };
      y = Math.max(y, ry + heights[i]);
    });
    var S = newStage("data", W, y + 10);
    var svg = S.svg;
    if (migrations.length) {
      var mg = s("g", { class: "migrations" }, s("text", { x: 0, y: 14, class: "col-label", text: T.migrations.toUpperCase() }));
      migrations.slice(0, 4).forEach(function (f, i) {
        var t = s("text", { x: 0, y: 38 + i * 20, class: "mig" }, s("tspan", { class: "st-" + f.status, text: f.status + "  " }), s("tspan", { text: trunc(f.path, 90) }));
        mg.appendChild(onOpen(t, f.path));
      });
      if (migrations.length > 4) mg.appendChild(s("text", { x: 0, y: 38 + 4 * 20, class: "info", text: "+" + (migrations.length - 4) }));
      svg.appendChild(mg);
    }
    var links = s("g", { class: "links" });
    svg.appendChild(links);
    S.links = [];
    DM.relations.forEach(function (rl) {
      var a = pos[rl.from], b = pos[rl.to];
      if (!a || !b) return;
      var ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2, d;
      var x1, y1, x2, y2;
      if (Math.abs(ay - by) < 10 || Math.abs(bx - ax) > Math.abs(by - ay)) {
        x1 = bx > ax ? a.x + a.w : a.x; x2 = bx > ax ? b.x : b.x + b.w; y1 = a.y + 26; y2 = b.y + 26;
        var mx = (x1 + x2) / 2; d = "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
      } else {
        x1 = ax; x2 = bx; y1 = by > ay ? a.y + a.h : a.y; y2 = by > ay ? b.y : b.y + b.h;
        var my = (y1 + y2) / 2; d = "M" + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + my + " " + x2 + "," + y2;
      }
      links.appendChild(s("path", { d: d, class: "rel rc-" + rl.change, "data-a": "ent:" + rl.from, "data-b": "ent:" + rl.to }));
      if (rl.label) {
        var lx = (x1 + x2) / 2, ly = (y1 + y2) / 2, lw = rl.label.length * 6.4 + 14;
        links.appendChild(s("g", { class: "rel-label rc-" + rl.change, "data-a": "ent:" + rl.from, "data-b": "ent:" + rl.to },
          s("rect", { x: r1(lx - lw / 2), y: r1(ly - 10), width: r1(lw), height: 20, rx: 10 }),
          s("text", { x: r1(lx), y: r1(ly + 4), "text-anchor": "middle", text: rl.label })));
      }
      S.links.push(["ent:" + rl.from, "ent:" + rl.to]);
    });
    ents.forEach(function (e) {
      var b = pos[e.id], key = "ent:" + e.id;
      S.geo[key] = b;
      var stt = { added: "new", changed: "changed", removed: "removed", same: "context" }[e.change];
      var g = s("g", { class: "entity st-" + stt, "data-k": key, tabindex: "0", role: "button" },
        s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, class: "box" }),
        s("rect", { x: b.x, y: b.y, width: b.w, height: 40, rx: 12, class: "head" }),
        s("rect", { x: b.x, y: b.y + 28, width: b.w, height: 12, class: "head" }),
        s("text", { x: b.x + 14, y: b.y + 25, class: "name", text: trunc(e.name, 24) }),
        s("text", { x: b.x + b.w - 12, y: b.y + 25, "text-anchor": "end", class: "tag", text: stt === "context" ? "" : statusLabel(stt).toUpperCase() }));
      (e.fields.length ? e.fields : [""]).forEach(function (f, i) {
        if (!f) return g.appendChild(s("text", { x: b.x + 14, y: b.y + 62, class: "info", text: e.component ? compName(e.component) : "" }));
        var k = fieldKind(f);
        g.appendChild(s("text", { x: b.x + 14, y: b.y + 62 + i * 19, class: "field f-" + k },
          s("tspan", { class: "fmark", text: { add: "+ ", del: "− ", mod: "~ ", same: "  " }[k] }), s("tspan", { text: trunc(fieldText(f), 28) })));
      });
      if (onNode) onNode(g, key);
      svg.appendChild(g);
    });
    S.keyOf = function (id) { return id.slice(0, 4) === "ent:" ? id : "ent:" + id; };
    S.expand = function (set) {
      var add = {};
      if (Object.keys(set).length === 1) S.links.forEach(function (l) { if (set[l[0]]) add[l[1]] = true; if (set[l[1]]) add[l[0]] = true; });
      Object.keys(add).forEach(function (k) { set[k] = true; });
      return set;
    };
    return S;
  }

  function artifactState(c, kind) {
    var list = c.artifacts.filter(function (a) { return a.kind === kind; });
    if (!list.length) return { cls: "absent", text: T.sAbsent };
    var changed = list.filter(function (a) { return a.status !== "="; });
    if (!changed.length) return { cls: "present", text: T.sUnchanged };
    if (c.deleted) return { cls: "removed", text: T.sDeleted };
    return { cls: "changed", text: changed.some(function (a) { return a.status === "A" || a.status === "R"; }) ? T.sAdded : T.sModified };
  }
  function pipelineSteps(c) {
    var touched = ctx.components.filter(function (x) { return x.status !== "context"; });
    var tk = c.tasks;
    var add = 0, del = 0;
    touched.forEach(function (x) { add += x.add; del += x.del; });
    return [
      { id: "proposal", title: T.proposal, state: artifactState(c, "proposal") },
      { id: "spec", title: T.specs, state: artifactState(c, "spec") },
      { id: "design", title: T.designDoc, state: artifactState(c, "design") },
      { id: "tasks", title: T.tasks, state: artifactState(c, "tasks"), progress: tk ? [tk.done, tk.total] : null },
      { id: "code", title: T.code, state: touched.length ? { cls: "changed", text: "+" + add + " −" + del } : { cls: "absent", text: "—" } },
      { id: "archive", title: T.archive, state: c.archived ? { cls: c.moved_to_archive ? "changed" : "present", text: c.moved_to_archive ? T.phaseArchiving : T.phaseArchived }
        : { cls: "absent", text: tk && tk.done < tk.total ? tf("openTasksN", { n: tk.total - tk.done }) : T.pending } }
    ];
  }

  // ═════════════════════════════ canvas + story ═════════════════════════════
  var STAGES = [{ id: "architecture", title: T.architecture }];
  if (ins) ins.flows.forEach(function (fl) { STAGES.push({ id: "flow:" + fl.id, title: fl.title, flow: fl }); });
  if (ins && ins.data_model && ins.data_model.entities.length) STAGES.push({ id: "data", title: T.dataStage });
  var flowById = {};
  if (ins) ins.flows.forEach(function (fl) { flowById[fl.id] = fl; });

  function autoStory() {
    var steps = [];
    var touched = ctx.components.filter(function (c) { return c.status !== "context"; });
    var layers = {};
    touched.forEach(function (c) { layers[compById[c.id].layer] = true; });
    steps.push({ heading: tf("autoOverviewH", { n: touched.length, m: Object.keys(layers).length }),
      body: tf("autoOverviewB", { f: st.files, a: fmt(st.add), d: fmt(st.del) }), stage: "architecture", focus: [] });
    ctx.edges.filter(function (e) { return e.violation && !e.violation.existing; }).slice(0, 2).forEach(function (e) {
      steps.push({ heading: tf("autoViolH", { a: compName(e.from), b: compName(e.to) }), body: e.violation.rule, stage: "architecture", focus: [e.from, e.to], code: e.refs[0] });
    });
    touched.filter(function (c) { return c.status === "new"; }).slice(0, 2).forEach(function (c) {
      steps.push({ heading: tf("autoNewH", { x: compName(c.id) }), body: tf("autoNewB", { l: layerName(c.id) }), stage: "architecture", focus: [c.id] });
    });
    touched.filter(function (c) { return c.status === "removed"; }).slice(0, 1).forEach(function (c) {
      steps.push({ heading: tf("autoRemovedH", { x: compName(c.id) }), body: T.autoRemovedB, stage: "architecture", focus: [c.id] });
    });
    touched.filter(function (c) { return c.status === "changed"; }).sort(function (a, b) { return (b.add + b.del) - (a.add + a.del) || byCompRank(a.id, b.id); })
      .slice(0, Math.max(0, 5 - steps.length)).forEach(function (c) {
        steps.push({ heading: tf("autoChangedH", { x: compName(c.id) }), body: tf("autoChangedB", { n: c.files, a: c.add, d: c.del }), stage: "architecture", focus: [c.id] });
      });
    if (OS && REQS.length) OS.changes.forEach(function (c) {
      if (c.requirements.length) steps.push({ heading: tf("autoSpecH", { n: c.requirements.length, id: c.id }), body: c.why || T.autoSpecB, stage: "spec",
        focus: c.requirements.map(function (r) { return r.id; }) });
    });
    return steps;
  }
  var STORY = ins && ins.story.length ? ins.story : autoStory();
  var storyIsAuto = !(ins && ins.story.length);

  function renderMap() {
    var compactQ = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
    var archMode = store("ec:arch-mode") || "delta";
    var motion = store("ec:motion");
    if (motion === null) motion = !REDUCED;
    var current = null, stepIdx = 0, inspecting = null;
    var cache = {};

    var viewport = h("div", { class: "viewport", tabindex: "0", "aria-label": T.canvas });
    var tabs = h("div", { class: "stage-tabs", role: "tablist" });
    var seg = h("div", { class: "seg arch-only" });
    ["delta", "after", "before"].forEach(function (m) {
      seg.appendChild(h("button", { class: m === archMode ? "on" : "", "data-m": m, text: T[m], onclick: function () {
        archMode = m; store("ec:arch-mode", m);
        Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle("on", b.getAttribute("data-m") === m); });
        if (current && current.id === "architecture") show("architecture", lastFocus, false);
      } }));
    });
    var motionBtn = h("button", { class: "icon-btn", title: T.motion, "aria-pressed": String(motion), onclick: function () { setMotion(!motion); } });
    // The bar holds what the diagram shows (stage, and before/after for the architecture); the view controls float
    // over the canvas, out of the way until needed.
    var tools = h("div", { class: "canvas-tools" }, seg);
    var viewTools = h("div", { class: "view-tools" },
      h("button", { class: "icon-btn", title: T.zoomOut, text: "−", onclick: function () { zoom(1.25); } }),
      h("button", { class: "icon-btn wide", title: T.fit, text: T.fit, onclick: function () { fly(fullBox(), true); } }),
      h("button", { class: "icon-btn", title: T.zoomIn, text: "+", onclick: function () { zoom(0.8); } }),
      motionBtn);
    // One tab per view: architecture │ flows │ data, with the story steps told on each. A title is never cut while it
    // fits; when the bar runs out of room it ends in "…" and the tooltip shows it whole.
    var lastKind = null;
    STAGES.forEach(function (stg) {
      var kind = stg.flow ? "flow" : stg.id;
      if (lastKind && kind !== lastKind) tabs.appendChild(h("span", { class: "stage-sep", "aria-hidden": "true" }));
      lastKind = kind;
      var n = STORY.filter(function (s) { return s.stage === stg.id; }).length;
      var label = h("span", { class: "stage-label", text: stg.title });
      tabs.appendChild(h("button", { role: "tab", class: "stage-tab" + (stg.flow ? " flow" : ""), "data-stage": stg.id,
        "aria-label": stg.title + (n ? " · " + tf("stageSteps", { n: n }) : ""),
        onmouseenter: function () {
          if (label.scrollWidth > label.clientWidth) this.title = stg.title; else this.removeAttribute("title");
        },
        onclick: function () {
          closeInspector();
          show(stg.id, [], true);
        } }, label, n ? h("span", { class: "stage-n", title: tf("stageSteps", { n: n }), text: String(n) }) : null));
    });
    var caption = h("div", { class: "stage-caption" });
    var legend = h("div", { class: "diagram-legend" });

    // ── camera ──
    var vb = null, anim = 0;
    function ratio() { var w = viewport.clientWidth || 1000, hh = viewport.clientHeight || 560; return w / hh; }
    function apply(v) { vb = v; if (current) current.svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map(r1).join(" ")); }
    function frame(box, pad, minW) {
      pad = pad === undefined ? 28 : pad;
      var x = box.x - pad, y = box.y - pad, w = box.w + 2 * pad, hh = box.h + 2 * pad;
      if (minW && w < minW) { x -= (minW - w) / 2; w = minW; }
      var r = ratio();
      if (w / hh > r) { var nh = w / r; y -= (nh - hh) / 2; hh = nh; } else { var nw = hh * r; x -= (nw - w) / 2; w = nw; }
      return { x: x, y: y, w: w, h: hh };
    }
    function fullBox() { return frame({ x: 0, y: 0, w: current.W, h: current.H }, 16); }
    function fly(target, animate) {
      cancelAnimationFrame(anim);
      if (!animate || !vb || REDUCED) return apply(target);
      var from = vb, t0 = 0, D = 560;
      function tick(now) {
        if (!t0) t0 = now;
        var t = Math.min(1, (now - t0) / D), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        apply({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
        if (t < 1) anim = requestAnimationFrame(tick);
      }
      anim = requestAnimationFrame(tick);
    }
    function zoom(f, cx, cy) {
      if (!vb) return;
      var w = Math.max(160, Math.min(vb.w * f, Math.max(current.W, current.H) * 3)), k = w / vb.w;
      cx = cx === undefined ? vb.x + vb.w / 2 : cx; cy = cy === undefined ? vb.y + vb.h / 2 : cy;
      fly({ x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: w, h: vb.h * k }, false);
    }
    var drag = null, dragged = false;
    viewport.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, vb: vb }; dragged = false;
    });
    viewport.addEventListener("pointermove", function (ev) {
      if (!drag || !vb) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!dragged) { dragged = true; try { viewport.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } viewport.classList.add("grabbing"); }
      var k = drag.vb.w / (viewport.clientWidth || 1);
      apply({ x: drag.vb.x - dx * k, y: drag.vb.y - dy * k, w: drag.vb.w, h: drag.vb.h });
    });
    function endDrag() { drag = null; viewport.classList.remove("grabbing"); }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("click", function (ev) { if (dragged) { ev.stopPropagation(); ev.preventDefault(); dragged = false; } }, true);
    viewport.addEventListener("wheel", function (ev) {
      if (!(ev.ctrlKey || ev.metaKey) || !vb) return;
      ev.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var cx = vb.x + (ev.clientX - rect.left) / rect.width * vb.w, cy = vb.y + (ev.clientY - rect.top) / rect.height * vb.h;
      zoom(ev.deltaY > 0 ? 1.12 : 0.89, cx, cy);
    }, { passive: false });

    // ── lighting ──
    var lastFocus = [];
    function light(ids) {
      var svg = current.svg, set = {};
      ids.forEach(function (id) { var k = current.keyOf(id); if (k) set[k] = true; });
      var focused = Object.keys(set).length > 0;
      if (focused) set = current.expand(set);
      svg.classList.toggle("dim", focused);
      svg.querySelectorAll("[data-k]").forEach(function (el) {
        var k = el.getAttribute("data-k");
        if (k.slice(0, 2) === "e:") return;
        el.classList.toggle("on", !!set[k]);
      });
      svg.querySelectorAll("[data-a]").forEach(function (el) {
        var a = el.getAttribute("data-a"), b = el.getAttribute("data-b");
        if (el.classList.contains("lifeline")) return el.classList.toggle("on", !!set[a]);
        var ka = current.keyOf(a) || a, kb = current.keyOf(b) || b;
        el.classList.toggle("on", !!((set[a] || set[ka]) && (set[b] || set[kb])));
      });
      return Object.keys(set);
    }
    function boxOf(keys) {
      var bs = keys.map(function (k) { return current.geo[k]; }).filter(Boolean);
      if (!bs.length) return null;
      var x1 = Math.min.apply(null, bs.map(function (b) { return b.x; })), y1 = Math.min.apply(null, bs.map(function (b) { return b.y; }));
      var x2 = Math.max.apply(null, bs.map(function (b) { return b.x + b.w; })), y2 = Math.max.apply(null, bs.map(function (b) { return b.y + b.h; }));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    // ── stages ──
    function stageFor(id) {
      var compact = compactQ.matches;
      var key = id + "|" + compact + "|" + (id === "architecture" ? archMode : "");
      if (cache[key]) return cache[key];
      var S;
      if (id === "architecture") S = buildArchitecture(archMode, compact, wireNode);
      else if (id === "data") S = buildData(wireNode);
      else S = buildFlow(flowById[id.slice(5)]);
      return (cache[key] = S);
    }
    function wireNode(g, id) {
      g.addEventListener("mouseenter", function () { if (!inspecting) light([id]); });
      g.addEventListener("mouseleave", function () { if (!inspecting) light(lastFocus); });
      g.addEventListener("click", function () { inspect(id); });
      g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); inspect(id); } });
    }
    function show(id, focus, animate) {
      // The spec has no diagram of its own: a requirement lights the components that implement it.
      if (id === "spec") { focus = specComponents(focus || []); id = "architecture"; }
      var prev = current;
      current = stageFor(id);
      if (prev !== current) {
        viewport.textContent = "";
        if (current.empty) viewport.appendChild(h("p", { class: "empty canvas-empty", text: current.empty }));
        viewport.appendChild(current.svg);
        if (!motion) try { current.svg.pauseAnimations(); } catch (e) { /* ignore */ }
        apply(prev && prev.id === current.id && vb ? vb : fullBox());
      }
      tabs.querySelectorAll(".stage-tab").forEach(function (b) {
        var on = b.getAttribute("data-stage") === id;
        b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
      });
      seg.style.display = id === "architecture" ? "" : "none";
      lastFocus = focus || [];
      var keys = light(lastFocus);
      // Narrow screens frame only what the step names; wide ones also keep what lights up with it in view.
      var primary = lastFocus.map(function (x) { return current.keyOf(x); });
      var box = keys.length ? (compactQ.matches && boxOf(primary)) || boxOf(keys) : null;
      // Never zoom past ~1.4× of the fitted view: the reader keeps the lanes around the focus in sight.
      fly(box ? frame(box, 64, Math.min(current.W, compactQ.matches ? 340 : Math.max(760, current.W * 0.62))) : fullBox(), animate);
      renderCaption(id);
    }
    function renderCaption(id) {
      caption.textContent = "";
      legend.textContent = "";
      // Only what the current diagram draws: [kind, colour, label, selector of an element that uses it].
      var keys = {
        architecture: [["swatch", "var(--new)", T.lNew, ".node.st-new"], ["swatch", "var(--changed)", T.lChanged, ".node.st-changed"],
          ["swatch", "var(--removed)", T.lRemoved, ".node.st-removed"], ["swatch", "var(--context)", T.lContext, ".node.st-context"],
          ["line anim", "var(--new)", T.lNew, ".edge.e-new"], ["line", "var(--context)", T.lSame, ".edge.e-same"],
          ["line dashed", "var(--removed)", T.lRemoved, ".edge.e-removed"], ["line", "var(--violation)", T.lViolation, ".edge.e-violation"],
          ["line", "var(--accent)", T.lHero, ".edge-g.hero"]],
        flow: [["line", "var(--new)", T.lNew, ".msg.st-new"], ["line", "var(--changed)", T.lChanged, ".msg.st-changed"],
          ["line", "var(--muted)", T.lSame, ".msg.st-same"], ["line dashed", "var(--removed)", T.lRemoved, ".msg.st-removed"]],
        data: [["swatch", "var(--new)", T.lNew, ".entity.st-new"], ["swatch", "var(--changed)", T.lChanged, ".entity.st-changed"],
          ["swatch", "var(--removed)", T.lRemoved, ".entity.st-removed"], ["swatch", "var(--context)", T.lContext, ".entity.st-context"]]
      }[id.slice(0, 5) === "flow:" ? "flow" : id] || [];
      append(legend, keys.filter(function (k) { return current.svg.querySelector(k[3]); }).map(function (k) { return legendItem(k[0], k[1], k[2]); }));
      if (id === "architecture") {
        var foot = [];
        if (st.unresolved) foot.push(st.unresolved + " " + T.unresolved);
        if (st.unmapped.length) foot.push(st.unmapped.length + " " + T.unmapped);
        if (foot.length) caption.appendChild(h("span", { class: "faint", text: foot.join(" · ") }));
      } else if (id.slice(0, 5) === "flow:") {
        flowNotes(flowById[id.slice(5)]).forEach(function (n) { caption.appendChild(n); });
      }
    }

    // ── story panel ──
    var storyList = h("ol", { class: "story-steps" });
    var counter = h("span", { class: "story-count" });
    var storyPane = h("div", { class: "story-pane" },
      h("div", { class: "story-head" },
        h("b", { text: T.story }), counter,
        h("div", { class: "story-nav" },
          h("button", { class: "icon-btn", title: T.prev, text: "←", onclick: function () { go(stepIdx - 1); } }),
          h("button", { class: "icon-btn", title: T.next, text: "→", onclick: function () { go(stepIdx + 1); } }))),
      storyIsAuto ? h("p", { class: "story-auto faint", text: T.storyAuto }) : null,
      storyList);
    var inspector = h("div", { class: "inspector", hidden: true });
    var side = h("aside", { class: "map-side" }, storyPane, inspector);
    var items = STORY.map(function (stp, i) {
      var li = h("li", { class: "story-step", tabindex: "0" },
        h("button", { class: "step-head", onclick: function () { go(i); } },
          h("span", { class: "step-n", text: String(i + 1) }),
          h("span", { class: "step-h", text: stp.heading })),
        h("div", { class: "step-body" }, h("p", { text: stp.body }),
          stp.stage === "spec" ? h("button", { class: "chip step-link", text: T.seeReqs + " ↓", onclick: function () {
            sddApi.open((stp.focus || []).filter(function (x) { return reqById[x]; }));
          } }) : null));
      storyList.appendChild(li);
      return li;
    });
    function go(i) {
      if (!STORY.length) return show("architecture", [], false);
      stepIdx = Math.max(0, Math.min(STORY.length - 1, i));
      closeInspector();
      var stp = STORY[stepIdx];
      items.forEach(function (li, j) { li.classList.toggle("active", j === stepIdx); li.classList.toggle("seen", j < stepIdx); });
      counter.textContent = (stepIdx + 1) + " / " + STORY.length;
      showCode(stp.code);
      show(stp.stage || "architecture", stp.focus || [], true);
      var li = items[stepIdx];
      if (li && storyList.scrollHeight > storyList.clientHeight) {
        storyList.scrollTo({ top: li.offsetTop - storyList.offsetTop - 8, behavior: REDUCED ? "auto" : "smooth" });
      }
    }

    // ── code of the active step, full width below the map. One splitter sets the map height, one the code height ──
    var codePane = h("div", { class: "map-code", hidden: true });
    function showCode(ref) {
      codePane.textContent = "";
      var ex = ref ? codeExcerpt(ref) : null;
      if (ex) codePane.appendChild(ex);
      codePane.hidden = codeSplit.hidden = !ex || !!inspecting;
    }
    var MIN_H = 240, MIN_CODE = 120;
    function maxH() { return Math.max(MIN_H, Math.round(window.innerHeight * 0.88)); }
    function clampH(px, min) { return Math.round(Math.max(min, Math.min(maxH(), px))); }
    function setHeight(px, save) {
      var before = viewport.clientHeight;
      viewport.style.height = px === null ? "" : clampH(px, MIN_H) + "px";
      if (save) store("ec:map-h", px === null ? null : viewport.clientHeight || clampH(px, MIN_H));
      // Same zoom, more or less of the stage around the centre: resizing never rescales the diagram.
      if (current && vb && before && viewport.clientHeight) {
        cancelAnimationFrame(anim);
        var nh = vb.h * viewport.clientHeight / before;
        apply({ x: vb.x, y: vb.y + (vb.h - nh) / 2, w: vb.w, h: nh });
      } else relayout();
    }
    // Set by the reader, the code area is exactly that tall (taller than a short excerpt too); by default it fits
    // the excerpt, up to 60% of the window.
    function setCodeHeight(px, save) {
      codePane.classList.toggle("sized", px !== null);
      if (px === null) codePane.style.removeProperty("--code-h");
      else codePane.style.setProperty("--code-h", clampH(px, MIN_CODE) + "px");
      if (save) store("ec:code-h", px === null ? null : clampH(px, MIN_CODE));
    }
    function codeHeight() { var ex = codePane.querySelector(".excerpt"); return ex ? ex.offsetHeight : 0; }
    // A drag handle: drag or arrow keys change a height, double-click or Home restores the default.
    function splitter(cls, getH, setH) {
      var el = h("div", { class: "splitter " + cls, role: "separator", tabindex: "0", "aria-orientation": "horizontal",
        "aria-label": T.resize, title: T.resize }, h("span", { class: "grip" }));
      var drag = null;
      el.addEventListener("pointerdown", function (ev) {
        if (ev.button) return;
        ev.preventDefault();
        drag = { y: ev.clientY, h: getH() };
        el.classList.add("dragging");
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      });
      el.addEventListener("pointermove", function (ev) { if (drag) setH(drag.h + ev.clientY - drag.y, false); });
      function end() { if (drag) { drag = null; el.classList.remove("dragging"); setH(getH(), true); } }
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("dblclick", function () { setH(null, true); });
      el.addEventListener("keydown", function (ev) {
        var d = { ArrowUp: -40, ArrowDown: 40, PageUp: -160, PageDown: 160 }[ev.key];
        if (ev.key === "Home") { ev.preventDefault(); setH(null, true); }
        else if (d) { ev.preventDefault(); ev.stopPropagation(); setH(getH() + d, true); }
      });
      return el;
    }
    var mapSplit = splitter("map-split", function () { return viewport.clientHeight; }, setHeight);
    var codeSplit = splitter("code-split", codeHeight, setCodeHeight);
    codeSplit.hidden = true;

    // ── inspector ──
    function inspect(key) {
      if (key.slice(0, 4) === "req:") return sddApi.open([key.slice(4)]);
      if (key.slice(0, 4) === "ent:") return inspectEntity(key.slice(4));
      var id = key.replace(/^comp:/, "");
      inspecting = id;
      var c = compById[id], n = changeComp[id] || { status: "context", files: 0, add: 0, del: 0 };
      var files = ctx.files.filter(function (f) { return f.component === id; });
      var syms = ctx.symbols.filter(function (sy) { return files.some(function (f) { return f.path === sy.file; }); });
      var outE = ctx.edges.filter(function (e) { return e.from === id; }), inE = ctx.edges.filter(function (e) { return e.to === id; });
      var reqs = reqsOfComp(id);
      inspector.textContent = "";
      append(inspector, [
        h("button", { class: "back", text: "← " + T.back, onclick: function () { go(stepIdx); } }),
        h("div", { class: "insp-title" }, h("span", { class: "badge " + n.status, text: statusLabel(n.status) }), h("h3", { text: c ? c.name : id })),
        h("div", { class: "faint", text: layerName(id) + (n.status !== "context" ? " · " + n.files + " " + (n.files === 1 ? T.file : T.kFiles) + " · +" + n.add + " −" + n.del : "") }),
        summaryOf[id] ? h("p", { class: "insp-summary", text: summaryOf[id] }) : c && c.desc ? h("p", { class: "insp-summary muted", text: c.desc }) : null,
        files.length ? inspList(T.files, files.map(function (f) {
          return h("div", { class: "insp-row" }, h("span", { class: "st st-" + f.status, text: f.status }), fileLink(f.path, f.path.split("/").pop()),
            h("span", { class: "nums" }, h("span", { class: "add", text: "+" + f.add }), " ", h("span", { class: "del", text: "−" + f.del })));
        })) : null,
        syms.length ? inspList(T.symbols, syms.slice(0, 12).map(function (sy) {
          return h("div", { class: "insp-row" }, h("span", { class: "badge " + { added: "new", removed: "removed", modified: "changed" }[sy.change], text: sy.change === "added" ? "+" : sy.change === "removed" ? "−" : "~" }),
            fileLink(sy.file, sy.name));
        })) : null,
        outE.length ? inspList(T.dependsOn, outE.map(edgeRow(function (e) { return e.to; }))) : null,
        inE.length ? inspList(T.usedBy, inE.map(edgeRow(function (e) { return e.from; }))) : null,
        reqs.length ? inspList(T.reqs, reqs.map(function (r) { return reqRow(r); })) : null]);
      storyPane.hidden = true; codePane.hidden = codeSplit.hidden = true;
      inspector.hidden = false;
      var stageId = current.id;
      if (current.id.slice(0, 5) === "flow:" && !current.geo["p:" + id]) stageId = "architecture";
      show(stageId, [id], true);
      inspecting = id;
    }
    function inspectEntity(eid) {
      var e = entById[eid], stt = { added: "new", changed: "changed", removed: "removed", same: "context" }[e.change];
      var rels = DM.relations.filter(function (r) { return r.from === eid || r.to === eid; });
      inspector.textContent = "";
      append(inspector, [
        h("button", { class: "back", text: "← " + T.back, onclick: function () { go(stepIdx); } }),
        h("div", { class: "insp-title" }, h("span", { class: "badge " + stt, text: statusLabel(stt) }), h("h3", { text: e.name })),
        e.component ? h("div", null, h("a", { href: "#", class: "faint", text: compName(e.component), onclick: function (ev) { ev.preventDefault(); inspect(e.component); } })) : null,
        e.fields.length ? inspList(T.fields, e.fields.map(function (f) {
          var k = fieldKind(f);
          return h("div", { class: "insp-row field-row f-" + k }, h("span", { class: "fmark", text: { add: "+", del: "−", mod: "~", same: "·" }[k] }), h("code", { text: fieldText(f) }));
        })) : null,
        rels.length ? inspList(T.relations, rels.map(function (r) {
          var other = r.from === eid ? r.to : r.from;
          return h("div", { class: "insp-row" }, h("span", { class: "badge " + { added: "new", changed: "changed", removed: "removed", same: "context" }[r.change], text: r.label || "—" }),
            h("a", { href: "#", text: (entById[other] || {}).name || other, onclick: function (ev) { ev.preventDefault(); inspectEntity(other); } }));
        })) : null,
        e.evidence ? h("div", { class: "insp-list" }, h("h4", { text: T.evidence }), codeExcerpt(e.evidence)) : null]);
      storyPane.hidden = true; codePane.hidden = codeSplit.hidden = true;
      inspector.hidden = false;
      show("data", [eid], true);
      inspecting = eid;
    }
    function closeInspector() { inspecting = null; inspector.hidden = true; storyPane.hidden = false; codePane.hidden = codeSplit.hidden = !codePane.firstChild; }
    function edgeRow(other) {
      return function (e) {
        var k = e.violation ? "violation" : e.status;
        return h("div", { class: "insp-row" },
          h("span", { class: "badge " + (k === "same" ? "context" : k), text: { new: "+", removed: "−", same: "=", violation: "!" }[k] }),
          h("a", { href: "#", text: compName(other(e)), onclick: function (ev) { ev.preventDefault(); inspect(other(e)); } }),
          e.refs[0] ? fileLink(e.refs[0], e.refs[0].split("/").pop()) : null);
      };
    }

    function setMotion(on) {
      motion = on; store("ec:motion", on);
      root.classList.toggle("still", !on);
      motionBtn.textContent = on ? "❚❚" : "▶";
      motionBtn.setAttribute("aria-pressed", String(on));
      Object.keys(cache).forEach(function (k) { try { cache[k].svg[on ? "unpauseAnimations" : "pauseAnimations"](); } catch (e) { /* ignore */ } });
    }

    var root = h("section", { class: "map", id: "map" },
      h("div", { class: "map-bar" }, tabs, tools),
      h("div", { class: "map-body" },
        h("div", { class: "map-canvas" }, h("div", { class: "stage-wrap" }, viewport, viewTools), h("div", { class: "map-foot" }, legend, caption, h("span", { class: "hint faint", text: T.canvasHint }))),
        mapSplit, codePane, codeSplit, side));
    setMotion(motion);
    if (store("ec:map-h")) setHeight(store("ec:map-h"), false);
    if (store("ec:code-h")) setCodeHeight(store("ec:code-h"), false);

    document.addEventListener("keydown", function (ev) {
      if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        var r = root.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        ev.preventDefault();
        go(stepIdx + (ev.key === "ArrowRight" ? 1 : -1));
      } else if (ev.key === "Escape" && inspecting) go(stepIdx);
    });
    function relayout() {
      if (!current) return;
      var want = stageFor(current.id);
      if (want !== current) { current = null; return go(stepIdx); }
      apply(vb ? frame({ x: vb.x, y: vb.y, w: vb.w, h: vb.h }, 0) : fullBox());
    }
    window.addEventListener("resize", function () { clearTimeout(relayout.t); relayout.t = setTimeout(relayout, 120); });
    document.addEventListener("ec:mounted", function () { current = null; go(0); });
    mapApi.inspect = function (id) { root.scrollIntoView({ block: "start" }); inspect(id); };
    mapApi.focus = function (stage, ids) { root.scrollIntoView({ block: "start" }); closeInspector(); show(stage, ids, true); };
    mapApi.showFlow = function (fid) { root.scrollIntoView({ block: "start" }); closeInspector(); show("flow:" + fid, [], true); };
    return root;
  }
  var mapApi = {};

  function codeExcerpt(ref) {
    var m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(ref || "");
    if (!m || fileIndex[m[1]] === undefined) return null;
    var f = ctx.files[fileIndex[m[1]]];
    return h("div", { class: "step-code" },
      h("div", { class: "step-code-head" }, fileLink(ref, m[1].split("/").slice(-2).join("/") + ":" + (m[3] ? m[2] + "-" + m[3] : m[2]))),
      h("div", { class: "excerpt diff-wrap" }, excerpt(f, m[3] ? m[2] + "-" + m[3] : m[2], 1)));
  }

  function flowNotes(fl) {
    var out = [];
    var ref = cfg.flows.filter(function (f) { return f.id === fl.id; })[0];
    if (fl.scenario) {
      var parts = fl.scenario.split("#"), r = reqById[parts[0]];
      var sc = r ? r.scenarios.filter(function (x) { return x.id === parts[1]; })[0] : null;
      if (sc) out.push(scenarioStrip(r, sc, true));
    }
    if (ref) {
      var diff = function (a, b) {
        var pool = b.map(function (x) { return x.from + ">" + x.to; });
        return a.filter(function (x) { var i = pool.indexOf(x.from + ">" + x.to); if (i < 0) return true; pool.splice(i, 1); return false; });
      };
      var extra = diff(fl.steps, ref.steps), missing = diff(ref.steps, fl.steps);
      out.push(h("span", { class: "muted" }, h("b", { text: T.vsReference + " “" + (ref.title || ref.id) + "”: " }),
        !extra.length && !missing.length ? T.matchesReference :
          [extra.length ? extra.length + " " + T.extraSteps : "", extra.length && missing.length ? " · " : "",
            missing.length ? missing.length + " " + T.missingSteps + " (" + missing.map(function (x) { return compName(x.from) + "→" + compName(x.to) + (x.msg ? ": " + x.msg : ""); }).join("; ") + ")" : ""]));
    }
    var unverified = fl.steps.filter(function (x) { return x.verified === false; });
    if (unverified.length) out.push(h("span", { class: "warn-text" }, "? " + T.unverifiedNote + " " +
      unverified.map(function (x) { return compName(x.from) + " → " + compName(x.to); }).join(", ")));
    return out;
  }
  // ── scenarios: GIVEN → WHEN → THEN as panels; AND/BUT belong to the panel above them ──
  var GWT = ["GIVEN", "WHEN", "THEN"];
  function gwtGroups(sc) {
    var g = { GIVEN: [], WHEN: [], THEN: [] }, cur = "GIVEN";
    sc.steps.forEach(function (x) {
      var k = String(x.k).toUpperCase();
      if (g[k]) cur = k;
      g[cur].push({ but: k === "BUT", t: x.t });
    });
    return g;
  }
  function flowButtons(r, sc) {
    return (ins ? ins.flows : []).filter(function (f) { return f.scenario === r.id + "#" + sc.id; }).map(function (f) {
      return h("button", { class: "chip flow-chip", title: f.title, text: "▶ " + T.showFlow, onclick: function () { mapApi.showFlow(f.id); } });
    });
  }
  // A scenario drawn as a flow: the state it starts from → the action → each outcome. Every AND/BUT line is a node
  // of its column; several preconditions join into the arrow and several outcomes branch out of it.
  var GWT_ICON = { GIVEN: "●", WHEN: "▶", THEN: "✓" }, GWT_FR = { GIVEN: "1fr", WHEN: ".85fr", THEN: "1.15fr" };
  function gwtFlow(g, keys, opts) {
    var cells = [];
    keys.forEach(function (k, i) {
      if (i) cells.push(h("span", { class: "gf-arrow", "aria-hidden": "true" }));
      var lines = g[k];
      cells.push(h("div", { class: "gf-col k-" + k.toLowerCase() + (opts.same && opts.same[k] ? " same" : "") + (lines.length ? "" : " empty"), role: "group", "aria-label": T["k" + k] },
        h("span", { class: "gf-k" }, h("i", { class: "gf-ico", text: GWT_ICON[k] }), T["k" + k]),
        h("div", { class: "gf-nodes" + (lines.length > 1 ? " multi" : "") },
          lines.length ? lines.map(function (l) {
            return h("div", { class: "gf-node" }, l.but ? h("b", { class: "gwt-but", text: T.but + " " }) : null, l.t);
          }) : h("div", { class: "gf-node empty", text: "—" }))));
    });
    return h("div", { class: "gwt-flow" + (opts.labels ? "" : " no-labels") + (opts.compact ? " compact" : ""),
      style: "grid-template-columns:" + keys.map(function (k) { return "minmax(0," + GWT_FR[k] + ")"; }).join(" 34px ") }, cells);
  }
  function gwtKeys(gs) { return GWT.filter(function (k) { return gs.some(function (g) { return g[k].length; }); }); }
  // One scenario. Compact is the flow caption's version.
  function scenarioStrip(r, sc, compact) {
    var g = gwtGroups(sc);
    return h("div", { class: "scn-card" + (compact ? " compact" : "") },
      h("div", { class: "scn-head" }, h("b", { text: (compact ? T.scenario + ": " : "") + sc.name }),
        compact ? h("span", { class: "faint", text: "· " + r.name }) : flowButtons(r, sc)),
      gwtFlow(g, gwtKeys([g]), { labels: true, compact: compact }));
  }
  // Several scenarios: one flow each on the same columns, labels once; a column equal to the one above fades,
  // so what differs between them stands out.
  function scenarioTable(r) {
    var gs = r.scenarios.map(gwtGroups), keys = gwtKeys(gs);
    return h("div", { class: "scn-list" }, r.scenarios.map(function (sc, i) {
      var same = {};
      keys.forEach(function (k) { same[k] = i > 0 && gs[i][k].length && JSON.stringify(gs[i][k]) === JSON.stringify(gs[i - 1][k]); });
      return h("div", { class: "scn-card" },
        h("div", { class: "scn-head" }, h("b", { text: sc.name }), flowButtons(r, sc)),
        gwtFlow(gs[i], keys, { labels: i === 0, same: same }));
    }));
  }
  function scenarioView(r) { return r.scenarios.length > 1 ? scenarioTable(r) : scenarioStrip(r, r.scenarios[0]); }
  function reqRow(r) {
    var stt = reqStatus(r);
    return h("div", { class: "insp-row" }, h("span", { class: "rs-dot rs-" + stt.replace("/", "") }),
      h("a", { href: "#sdd", text: trunc(r.name, 48), onclick: function (ev) { ev.preventDefault(); sddApi.open([r.id]); } }));
  }

  // ═════════════════════════════ SDD · OpenSpec ═════════════════════════════
  // Each change as its pipeline, then one matrix for all requirements: requirement × component, tests and status.
  // A row opens to its scenarios and evidence. The map does not draw the spec; it lights the components it names.
  var sddApi = { open: function () {} };
  function artifactBody(c, kind) {
    var body = [];
    if (kind === "proposal") {
      if (c.why) body.push(inspList(T.why, [h("p", { class: "insp-summary", text: c.why })]));
      if (c.what.length) body.push(inspList(T.whatChanges, [h("ul", { class: "tight" }, c.what.map(function (x) { return h("li", { text: x }); }))]));
      if (c.impact.length) body.push(inspList(T.impact, [h("ul", { class: "tight" }, c.impact.map(function (x) { return h("li", { text: x }); }))]));
    } else if (kind === "design") {
      if (c.decisions.length) body.push(inspList(T.decisionsDoc, [h("ul", { class: "tight" }, c.decisions.map(function (x) { return h("li", { text: x }); }))]));
    } else if (kind === "tasks" && c.tasks) {
      c.tasks.groups.forEach(function (g, gi) {
        body.push(inspList(g.title + " · " + g.done + "/" + g.total, c.tasks.items.filter(function (x) { return x.group === gi; }).map(function (x) {
          return h("div", { class: "insp-row task" + (x.done ? " done" : "") }, h("span", { class: "task-box", text: x.done ? "✓" : "" }), h("span", { text: x.t }));
        })));
      });
    } else if (kind === "spec") {
      if (c.requirements.length) body.push(inspList(T.reqs, c.requirements.map(reqRow)));
    } else if (kind === "code") {
      var touched = ctx.components.filter(function (x) { return x.status !== "context"; });
      if (touched.length) body.push(inspList(T.kComponents, touched.map(function (x) {
        return h("div", { class: "insp-row" }, h("span", { class: "badge " + x.status, text: statusLabel(x.status) }),
          h("a", { href: "#map", text: compName(x.id), onclick: function (ev) { ev.preventDefault(); mapApi.inspect(x.id); } }));
      })));
    }
    var art = c.artifacts.filter(function (a) { return a.kind === kind; });
    if (art.length) body.push(h("div", { class: "insp-list" }, art.map(function (a) { return h("div", { class: "insp-row" }, fileLink(a.path, a.path.split("/").slice(-3).join("/"))); })));
    return body.length ? body : null;
  }
  function inspList(title, rows) { return h("div", { class: "insp-list" }, h("h4", { text: title }), rows); }

  // The pipeline as a stepper; a step opens its document right below it.
  function sddPipeline(c) {
    var panel = h("div", { class: "sdd-doc", hidden: true }), open = null;
    var list = h("ol", { class: "sdd-pipe" }, pipelineSteps(c).map(function (stp, i) {
      var body = artifactBody(c, stp.id), p = stp.progress;
      var btn = h("button", { class: "pstep ps-" + stp.state.cls, disabled: !body, "aria-expanded": body ? "false" : null, title: stp.title + " · " + stp.state.text },
        h("span", { class: "pdot", text: { present: "✓", removed: "✗" }[stp.state.cls] || String(i + 1) }),
        h("span", { class: "pname", text: stp.title }),
        h("span", { class: "pstate", text: p ? p[0] + "/" + p[1] : stp.state.text }),
        p ? h("span", { class: "pbar" }, h("i", { class: p[0] === p[1] ? "full" : "", style: "width:" + (p[1] ? Math.round(100 * p[0] / p[1]) : 0) + "%" })) : null);
      if (body) btn.addEventListener("click", function () {
        var again = open === btn;
        if (open) { open.classList.remove("on"); open.setAttribute("aria-expanded", "false"); }
        panel.textContent = ""; panel.hidden = true; open = null;
        if (again) return;
        open = btn; btn.classList.add("on"); btn.setAttribute("aria-expanded", "true");
        append(panel, body); panel.hidden = false;
      });
      return h("li", null, btn);
    }));
    return [h("div", { class: "sdd-pipe-wrap" }, list), panel];
  }

  // How many requirements are met, as one bar.
  function sddCoverage() {
    var n = {};
    REQS.forEach(function (r) { var k = reqStatus(r); n[k] = (n[k] || 0) + 1; });
    var shown = ["implemented", "partial", "missing", "n/a", "pending"].filter(function (k) { return n[k]; });
    if (!shown.length) return null;
    return h("div", { class: "sdd-cov" },
      h("div", { class: "cov-bar", role: "img", "aria-label": shown.map(function (k) { return n[k] + " " + rsLabel(k); }).join(", ") },
        shown.map(function (k) { return h("span", { class: "rs-" + k.replace("/", ""), style: "flex:" + n[k], title: n[k] + " " + rsLabel(k) }); })),
      h("div", { class: "cov-legend" }, shown.map(function (k) {
        return h("span", null, h("i", { class: "rs-dot rs-" + k.replace("/", "") }), h("b", { text: String(n[k]) }), rsLabel(k));
      })));
  }

  function sddMatrix() {
    var comps = [];
    REQS.forEach(function (r) { var m = specMap[r.id]; if (m) m.components.forEach(function (c) { if (comps.indexOf(c) < 0) comps.push(c); }); });
    comps.sort(byCompRank);
    var heads = {}, reqs = [];
    // Hovering a row lights its components' columns; hovering a column lights the rows that use it.
    function lightRow(det, on) { det.comps.forEach(function (c) { heads[c].classList.toggle("lit", on); }); }
    function lightCol(c, on) {
      heads[c].classList.toggle("lit", on);
      reqs.forEach(function (det) { if (det.comps.indexOf(c) > -1) det.classList.toggle("lit", on); });
    }
    var grid = h("div", { class: "sdd-grid", style: "--cols:minmax(240px, 520px) 136px 56px" + (comps.length ? " repeat(" + comps.length + ", 46px)" : "") },
      h("div", { class: "sdd-row sdd-head" },
        h("span", { text: T.reqs }),
        h("span", { text: T.status }),
        h("span", { class: "num", text: T.tests }),
        comps.map(function (c) {
          var stt = (changeComp[c] || {}).status || "context";
          return (heads[c] = h("button", { class: "sdd-comp st-" + stt, title: compName(c) + " · " + layerName(c) + " · " + statusLabel(stt),
            onclick: function () { mapApi.inspect(c); }, onmouseenter: function () { lightCol(c, true); }, onmouseleave: function () { lightCol(c, false); } },
            h("span", { class: "vtext", text: trunc(compName(c), 28) })));
        })));
    var lastCap = null;
    REQS.forEach(function (r) {
      var capKey = r.cap + (r.change ? "" : " · " + T.mainSpec);
      if (capKey !== lastCap) { grid.appendChild(h("div", { class: "sdd-cap", text: capKey })); lastCap = capKey; }
      var m = specMap[r.id], stt = reqStatus(r), cls = stt.replace("/", "");
      var tests = m ? m.tests.filter(function (x, i, a) { return a.indexOf(x) === i; }) : [];
      var det = h("details", { class: "sdd-req op-" + r.op + " rs-" + cls, open: stt === "partial" || stt === "missing" || REQS.length <= 3 },
        h("summary", { class: "sdd-row" },
          h("span", { class: "sdd-name" },
            h("span", { class: "op-tag op-" + r.op, text: (T["op" + r.op] || r.op) + (r.merged ? " · " + T.merged : "") }),
            h("b", { text: r.name }),
            r.scenarios.length ? h("span", { class: "faint scn-count", text: r.scenarios.length + " " + (r.scenarios.length === 1 ? T.scenario : T.scenarios).toLowerCase() }) : null),
          h("span", { class: "rs-pill rs-" + cls, text: RS_ICON[stt] + " " + rsLabel(stt) }),
          h("span", { class: "sdd-cell num" + (tests.length ? "" : " faint"), title: tests.join("\n") || null, text: tests.length ? "⚗ " + tests.length : "—" }),
          comps.map(function (c) {
            var on = !!m && m.components.indexOf(c) > -1;
            return h("span", { class: "sdd-cell", title: on ? compName(c) : null }, on ? h("i", { class: "cell-dot rs-" + cls }) : null);
          })),
        h("div", { class: "sdd-detail" },
          r.text ? h("p", { class: "sdd-text", text: r.text }) : null,
          m && m.note ? h("div", { class: "sdd-note rs-" + cls }, h("b", { text: RS_ICON[stt] + " " + cap(rsLabel(stt)) }), " " + m.note) : null,
          m && m.components.length ? h("div", { class: "sdd-comps-m" }, m.components.map(function (c) { return h("span", { class: "badge " + ((changeComp[c] || {}).status || "context"), text: compName(c) }); })) : null,
          r.scenarios.length ? scenarioView(r) : null,
          h("div", { class: "sdd-foot" },
            tests.map(function (x) { return h("span", { class: "test-ref" }, "⚗ ", fileLink(x, x.split("/").pop())); }),
            h("span", { class: "faint" }, "spec ", fileLink(r.file + ":" + r.line, r.file.split("/").slice(-3).join("/"))),
            m && m.components.length ? h("button", { class: "chip", text: "◇ " + T.showOnMap, onclick: function () { mapApi.focus("architecture", m.components); } }) : null)));
      det.comps = m ? m.components : [];
      det.rid = r.id;
      det.addEventListener("mouseenter", function () { lightRow(det, true); });
      det.addEventListener("mouseleave", function () { lightRow(det, false); });
      reqs.push(det);
      grid.appendChild(det);
    });
    sddApi.open = function (ids) {
      var hit = reqs.filter(function (d) { return ids.indexOf(d.rid) > -1; });
      hit.forEach(function (d) {
        d.open = true;
        d.classList.remove("flash");
        void d.offsetWidth;
        d.classList.add("flash");
      });
      var target = hit[0] || document.getElementById("sdd");
      if (target) target.scrollIntoView({ block: hit[0] ? "center" : "start", behavior: REDUCED ? "auto" : "smooth" });
    };
    return h("div", { class: "sdd-matrix" }, grid,
      !(ins && ins.spec && ins.spec.length) ? h("p", { class: "empty sdd-pending", text: T.pendingMap }) : null);
  }

  function renderSpec() {
    if (!OS || !REQS.length) return null;
    return sectionShell("sdd", T.spec + " · " + T.openspec, [
      OS.changes.map(function (c) {
        var phase = c.moved_to_archive ? T.phaseArchiving : c.archived ? T.phaseArchived : T.phaseActive;
        return h("div", { class: "card sdd-change" },
          h("div", { class: "sdd-change-head" }, h("code", { class: "sdd-id", text: "openspec/" + c.id }),
            h("span", { class: "badge " + (c.archived || c.moved_to_archive ? "context" : "changed"), text: phase })),
          c.why ? h("p", { class: "sdd-why", text: c.why }) : null,
          sddPipeline(c));
      }),
      h("div", { class: "card sdd-reqs" }, h("h3", { text: T.reqs }), sddCoverage(), sddMatrix())],
      tf("leadSpec", { n: REQS.length, i: REQS.filter(function (r) { return reqStatus(r) === "implemented"; }).length }));
  }

  // ═════════════════════════════ sections below the map ═════════════════════════════
  // Order of reading: why it is built this way (decisions) → what the spec asks (SDD) → where it changed (files).

  // Why the change is built this way: the agent's design decisions, each with its main alternative.
  function renderDecisions() {
    if (!ins || !ins.decisions.length) return null;
    return sectionShell("decisions", T.decisions, [
      h("div", { class: "decisions" }, ins.decisions.map(function (d) {
        return h("div", { class: "card decision" },
          h("h3", { text: d.title }),
          h("p", { text: d.why }),
          d.alternative ? h("p", { class: "alt" }, h("b", { text: T.alternative + ": " }), d.alternative) : null,
          d.evidence ? fileLink(d.evidence) : null);
      }))], ins.decisions.length === 1 ? T.leadDecision1 : tf("leadDecisions", { n: ins.decisions.length }));
  }

  // Where it changed: one row per changed component (status, summary, files), then tests and files outside the map.
  // Rows are open when the change is small enough to read whole.
  function renderChanges() {
    var comps = ctx.components.filter(function (c) { return c.status !== "context"; }).map(function (c) { return c.id; }).sort(byCompRank);
    var byComp = {}, tests = [], outside = [];
    ctx.files.forEach(function (f) {
      if (f.category === "ignored") return;
      if (f.category === "test") tests.push(f);
      else if (f.component && comps.indexOf(f.component) > -1) (byComp[f.component] = byComp[f.component] || []).push(f);
      else outside.push(f);
    });
    var nFiles = ctx.files.filter(function (f) { return f.category !== "ignored"; }).length;
    if (!nFiles) return null;
    var open = nFiles <= 24;
    function nums(add, del) { return h("span", { class: "nums" }, h("span", { class: "add", text: "+" + fmt(add) }), " ", h("span", { class: "del", text: "−" + fmt(del) })); }
    function sum(fs, k) { return fs.reduce(function (a, f) { return a + f[k]; }, 0); }
    function fileRows(fs) {
      return h("div", { class: "chg-files" }, fs.map(function (f) {
        return h("div", { class: "insp-row" }, h("span", { class: "st st-" + f.status, text: f.status }),
          fileLink(f.path), nums(f.add, f.del));
      }));
    }
    function group(badge, name, meta, summary, fs, onMap) {
      return h("details", { class: "chg", open: open },
        h("summary", { class: "chg-head" },
          h("span", { class: "chg-line" }, badge, h("b", { class: "chg-name", text: name }),
            meta ? h("span", { class: "faint", text: meta }) : null,
            h("span", { class: "chg-count faint", text: fs.length + " " + (fs.length === 1 ? T.file : T.kFiles) }), nums(sum(fs, "add"), sum(fs, "del"))),
          summary ? h("span", { class: "chg-summary", text: summary }) : null),
        fileRows(fs),
        onMap ? h("button", { class: "chip", text: T.showOnMap, onclick: onMap }) : null);
    }
    return sectionShell("changes", T.changesTitle, h("div", { class: "card chg-list" }, [
      comps.filter(function (id) { return byComp[id]; }).map(function (id) {
        var n = changeComp[id], c = compById[id];
        return group(h("span", { class: "badge " + n.status, text: statusLabel(n.status) }), compName(id), layerName(id),
          summaryOf[id] || (c && c.desc) || null, byComp[id], function () { mapApi.inspect(id); });
      }),
      tests.length ? group(null, T.testFiles, null, null, tests) : null,
      outside.length ? group(null, T.outsideMap, null, null, outside) : null]),
      tf("leadChanges", { c: comps.length, f: nFiles }));
  }

  function excerpt(f, lines, ctxLines) {
    var m = /^(\d+)(?:-(\d+))?$/.exec(String(lines));
    var a = +m[1], b = +(m[2] || m[1]), c = ctxLines === undefined ? 3 : ctxLines;
    var side = f.status === "D" ? "old" : "new";
    var table = h("table", { class: "diff" });
    f.hunks.forEach(function (hk) {
      var lo = hk[side + "_start"], hi = lo + Math.max(hk[side + "_len"], 1) - 1;
      if (a > hi || b < lo) return;
      table.appendChild(diffRows(hk, function (n) { return n >= a - c && n <= b + c; }, side, a, b));
    });
    return table;
  }

  function diffRows(hk, keep, side, hlA, hlB) {
    var frag = document.createDocumentFragment();
    frag.appendChild(h("tr", { class: "hh" }, h("td", { colspan: "4", text: "@@ −" + hk.old_start + "," + hk.old_len + " +" + hk.new_start + "," + hk.new_len + " @@ " + (hk.header || "") })));
    var o = hk.old_start, n = hk.new_start;
    hk.lines.forEach(function (ln) {
      var t = ln[0], ref = side === "old" ? o : n;
      var show = !keep || keep(t === "+" ? n : t === "-" ? (side === "old" ? o : n) : ref);
      if (show) {
        var inRange = hlA && ref >= hlA && ref <= hlB && t !== (side === "old" ? "+" : "-");
        frag.appendChild(h("tr", { class: (t === "+" ? "a" : t === "-" ? "d" : "") + (inRange ? " hl" : ""), "data-n": t === "-" ? null : n },
          h("td", { class: "ln", text: t === "+" ? "" : o }),
          h("td", { class: "ln", text: t === "-" ? "" : n }),
          h("td", { class: "sg", text: t === " " ? "" : t }),
          h("td", { class: "code", text: ln[1] })));
      }
      if (t !== "+") o++;
      if (t !== "-") n++;
    });
    return frag;
  }

  // ═════════════════════════════ shell ═════════════════════════════
  function themeButton() {
    var modes = ["auto", "light", "dark"];
    var cur = store("ec:theme") || "auto";
    function apply() {
      if (cur === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", cur);
      btn.textContent = "◐ " + T["theme" + cap(cur)];
      btn.title = T.theme;
    }
    var btn = h("button", { class: "theme-btn", onclick: function () { cur = modes[(modes.indexOf(cur) + 1) % 3]; store("ec:theme", cur); apply(); } });
    apply();
    return btn;
  }

  var app = document.getElementById("app");
  var main = h("main");
  main.appendChild(renderHeader());
  main.appendChild(renderMap());
  var below = [
    { id: "decisions", title: T.decisions, n: ins ? ins.decisions.length : 0, el: renderDecisions() },
    { id: "sdd", title: T.spec, n: REQS.length, el: renderSpec() },
    { id: "changes", title: T.delta, n: ctx.files.filter(function (f) { return f.category !== "ignored"; }).length, el: renderChanges() }
  ].filter(function (x) { return x.el; });
  below.forEach(function (x) { main.appendChild(x.el); });
  var navList = h("nav", { class: "topnav" },
    h("a", { href: "#map", "data-sec": "map", text: T.canvas }),
    below.map(function (x) {
      return h("a", { href: "#" + x.id, "data-sec": x.id }, x.title, h("span", { class: "nav-n", text: String(x.n) }));
    }));
  var bar = h("div", { class: "topbar" },
    h("a", { class: "brand", href: "#summary" }, h("span", { class: "brand-mark", text: "◇" }), h("span", { class: "brand-name", text: "explain-change" })),
    navList,
    themeButton());
  app.appendChild(bar);
  app.appendChild(main);
  app.appendChild(h("footer", { class: "foot faint", text: "explain-change " + (DATA.tool || "") + " · key " + ctx.key }));
  document.dispatchEvent(new CustomEvent("ec:mounted"));

  if ("IntersectionObserver" in window) {
    var links = navList.querySelectorAll("a[data-sec]");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-sec") === en.target.id); });
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    main.querySelectorAll("section[id]").forEach(function (sct) { io.observe(sct); });
  }
})();
