"use strict";
/*
 * Checkpoint front end. Plain JavaScript, no build step.
 * Every number on screen comes from the Python engine through /api (see checkpoint/server.py).
 * The board only lets the player choose start edges and spans; end edges, legality, Verify and
 * all metrics are computed by the engine.
 *
 * Layout: a beige CRT monitor (index.html). #view holds the current screen, #layer its windows,
 * menus and printouts, #toasts the notifications, #strip the physical buttons on the bezel, and
 * #tour the guided tour, which sits above everything.
 */

const C = {
  ink: "#2c2116", bone: "#e6d8b7", hi: "#faf3df", lo: "#b3a079", engrave: "#cdbd96",
  green: "#7fe08e", hot: "#ff6a3d", red: "#e5634d", violet: "#6b4a9a",
  phos: "#8fd6a4", phosHi: "#c9f6d4", phosDim: "#2c5443", phosGrid: "#1d3329", yellow: "#e8c34a", orange: "#f08a3c",
};
const PAULI = {
  Z: { bright: "#45d6ac", dark: "#2a9f80", text: "#1f6f57", ring: "#1f8f6f", grad: "pulseZ" },
  X: { bright: "#5b9cf0", dark: "#3a6fb8", text: "#24508f", ring: "#2f63ad", grad: "pulseX" },
  Y: { bright: "#e8c34a", dark: "#a88a24", text: "#6f5a10", ring: "#9a7d14", grad: "pulseY" },
  bad: { bright: "#e5634d", dark: "#8f3426", text: "#8f3426", ring: "#c23b2a", grad: "pulseRed" },
};
const LETTERS = "ABCDEFGHIJ";
const GATE_LABEL = { h: "H", s: "S", sdg: "S†", x: "X", y: "Y", z: "Z", sx: "√X", sxdg: "√X†", t: "T", tdg: "T†", id: "I" };
const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const S = {
  levels: [], level: null, checks: [], pending: null, tool: "Z", preview: null,
  result: null, landscape: null, series: null, view: "select", blocked: null, busy: false,
  modal: null, info: null, menu: false, openCheck: null, codeOpen: false, print: null, tour: null, startTourAfterAbout: false,
  solution: null, // {preview, result} of the puzzle's stored solution, once the player asked to see it
};
const $view = document.getElementById("view");
const $layer = document.getElementById("layer");
const $toasts = document.getElementById("toasts");
const $strip = document.getElementById("strip");
const $tour = document.getElementById("tour");
const $screen = document.getElementById("screen");

const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v, d = 1) => (v == null ? "--" : (v * 100).toFixed(d) + "%");
const f3 = (v) => (v == null ? "--" : Number(v).toFixed(3));
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;
const edgeText = (paulis) => Object.entries(paulis || {}).map(([q, p]) => `${p} on q${q}`).join(", ");

/* ------------------------------------------------------------------ copy */

const SERIES_COPY = {
  "T-count": {
    title: "T-COUNT STUDY",
    text: "These four puzzles use the same circuit family with 0, 2, 4, and 8 T/T† gates. Compare the legal check paths, then record the best Fidelity found while keeping Yield at or above 85%. Circuit depth and gate placement also matter, so do not attribute every change to T count alone.",
  },
};

const GLOSSARY = [
  ["Terms", [
    ["Quantum circuit", "A sequence of quantum gates acting on qubits. The circuit is the computation we want to run."],
    ["Noise", "Random errors introduced by gates, idle time, or measurement. Noise can make the measured result differ from the ideal result."],
    ["Check", "An extra measurement process that can flag certain errors. In Checkpoint, flagged runs are discarded instead of repaired."],
    ["Pauli X, Y, and Z", "Three basic operators used to define the check. Which one you choose affects which errors can flip the check's outcome. The game propagates the operator through the gates in the check's span."],
    ["Ancilla", "An extra qubit used to perform a check. Ancillas are a limited resource and can themselves be affected by noise."],
    ["Span", "The part of the circuit between a check's start edge and end edge. A longer span can cover more gates, but the ancilla waits through more of the circuit."],
    ["Syndrome", "The result of a check. A non-zero/1 result flags the run, so Checkpoint rejects it during post-selection."],
    ["Post-selection", "Keeping only runs whose checks all have the accepted syndrome result. This can improve the retained results, but reduces Yield."],
    ["Phase flip / Z error", "An error associated with Z that changes a qubit's relative phase. It can change later measurement outcomes when the circuit makes that phase observable. A Z check commutes with a Z error and cannot flag it; an X check anticommutes with it and can."],
    ["Pauli propagation", "The game carries the check's Pauli operator through the gates in its span to compute the matching end edge. Clifford gates map Pauli operators to Pauli operators; T and T† impose an extra restriction."],
    ["T gate", "A non-Clifford gate. In this game, a check may cross T or T† only if its propagated operator is I or Z on the qubit acted on by that gate."],
    ["Merged check / final-readout mode", "If a check ends at the final slot with only Z and identity on the data qubits, the game can include its end-edge parity in the final measurement instead of adding end-edge gates. This can make some measurement errors visible to the check, though parity can hide pairs of flips."],
    ["Pauli trail and glow", "Inside a check's span, small chips show its Pauli at every slot, and the wires it watches glow in its colour. An error is flagged when it happens on a glowing wire and anticommutes with the Pauli there."],
    ["Correct result", "What every noiseless result has in common, shown in the i window. For example, q1 = 0 means q1 always reads 0; q0 = q3 means they always agree. A good check usually tests one of these rules."],
    ["Seen (on an error badge)", "The share of that gate's possible errors your checks would flag, counting one error at a time. It is computed from which Pauli errors anticommute with a check right after that gate."],
    ["Verify", "A noiseless test. It checks that the added checks preserve the circuit's intended output and do not flag a run when there are no errors. It does not measure performance under noise."],
    ["Automated reference", "A check layout produced by qiskit-paulice for comparison. It is a reference strategy, not an automatically optimal answer for every metric in Checkpoint."],
    ["Evaluated layouts / trade-off frontier", "Checkpoint scores a set of legal layouts and plots them. A layout is on the frontier when none of the other evaluated layouts improves both Fidelity and Yield. The search is not an exhaustive proof of the best possible layout."],
  ]],
  ["Metrics", [
    ["Fidelity (higher is better)", "The Hellinger fidelity between the ideal measurement distribution and the distribution of the runs that survive the checks. It measures how closely the kept measurement results match the ideal results. It is not the same as quantum-state fidelity."],
    ["Yield (higher is better)", "The fraction of all runs that survive every check. If 8,000 of 10,000 runs are kept, Yield is 80%."],
    ["Cost (lower is better)", "Checkpoint's resource score: number of ancilla qubits plus extra two-qubit gates. Extra circuit depth is tracked separately. It is a game metric, not a universal hardware-cost formula."],
    ["Extra depth (lower is usually better)", "Extra circuit layers added by the checks. It can add noise; the actual impact depends on the noise model and the operation sequence."],
    ["Why they trade off", "A check can reject runs with detectable errors, improving the results that remain. But it can also reject useful runs and add noisy gates. Compare all three metrics before deciding a layout is better. A layout is only a good solution if it meets the puzzle's required targets; among layouts that do, compare Yield and Cost rather than chasing the highest Fidelity alone."],
  ]],
  ["Results screen symbols", [
    ["▼ yellow", "This run."],
    ["★", "Your best result on that metric among your solved runs, the ones that met every target (highest Fidelity, highest Yield, lowest Cost). They can come from different runs. No star until you solve the puzzle."],
    ["◆ orange", "The automated reference, when the puzzle has one."],
    ["Line on a chart", "The puzzle's target. Bars on the passing side are green; bars on the failing side are red."],
    ["O and X", "O means the target is met; X means it is missed."],
  ]],
];

/* ------------------------------------------------------------------ remembered progress, history and preferences */

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable: not remembered */ }
}
const loadBest = () => loadJSON("checkpoint-best", {});
function saveBest(id, m, met) {
  const b = loadBest();
  const old = b[id];
  if (!old || (met && !old.met) || (met === old.met && m.fidelity > old.fidelity)) {
    b[id] = { fidelity: m.fidelity, yield: m.yield, cost: m.cost, met };
    saveJSON("checkpoint-best", b);
  }
}
// Every scored run, per puzzle, so the results screen can mark the player's bests and past attempts.
const HISTORY_MEMORY = {};
function loadHistory(id) { return loadJSON("checkpoint-history", HISTORY_MEMORY)[id] || []; }
function addHistory(id, m, met) {
  const h = loadJSON("checkpoint-history", HISTORY_MEMORY);
  h[id] = (h[id] || []).concat([{ fidelity: m.fidelity, yield: m.yield, cost: m.cost, met }]).slice(-60);
  Object.assign(HISTORY_MEMORY, h);
  saveJSON("checkpoint-history", h);
}
function status(id) {
  const b = loadBest()[id];
  if (b && b.met) return "solved";
  if (b || loadHistory(id).length) return "tried";
  return "new";
}

const PREFS = loadJSON("checkpoint-prefs", {});
function setPref(key, value) { PREFS[key] = value; saveJSON("checkpoint-prefs", PREFS); }
function applyCrt() { document.documentElement.classList.toggle("crt-off", PREFS.crt === false); }

/* ------------------------------------------------------------------ toasts */

let toastSeq = 0;
function toast(kind, title, lines = [], why = null) {
  const el = document.createElement("div");
  el.className = `toast bevel ${kind}`;
  el.dataset.toast = String(++toastSeq);
  el.dataset.kind = kind;
  el.innerHTML = `<div class="ic" aria-hidden="true">${kind === "error" ? "!" : kind === "success" ? "✓" : "i"}</div>
    <div><b>${esc(title)}</b>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    ${why ? `<button type="button" class="why" data-why aria-expanded="false">WHY?</button><div class="more" hidden>${esc(why)}</div>` : ""}</div>
    <button type="button" class="x" data-toast-close aria-label="Close notification">✕</button>`;
  $toasts.prepend(el);
  while ($toasts.children.length > 2) $toasts.lastElementChild.remove();
  if (kind !== "error") {
    let left = kind === "success" ? 6000 : 4500, started = 0, timer = null;
    const run = () => { started = Date.now(); timer = setTimeout(() => el.remove(), left); };
    const pause = () => { clearTimeout(timer); left -= Date.now() - started; };
    el.addEventListener("mouseenter", pause); el.addEventListener("focusin", pause);
    el.addEventListener("mouseleave", run); el.addEventListener("focusout", run);
    run();
  }
}
function clearToasts(kind) { for (const el of [...$toasts.children]) if (!kind || el.dataset.kind === kind) el.remove(); }

function propagateToast(pr) {
  const m = /as ([XY]) on qubit (\d+)/.exec(pr.message || "");
  const [lo, hi] = slotRange();
  switch (pr.error) {
    case "t_rule": return toast("error", "Blocked by a T gate", [m ? `${m[1]} cannot pass the T gate on q${m[2]}.` : "This Pauli cannot pass a T gate.", "Only Z can pass. Try a different span."], pr.message);
    case "slots": return toast("error", "Slot not allowed", [`This puzzle uses slots ${lo} to ${hi}.`], pr.message);
    case "bad_span": return toast("error", "Ends before it starts", ["Set the end at a later slot."], pr.message);
    case "empty": return toast("error", "No start edge", ["Place the start on a qubit first."], pr.message);
    default: return toast("error", "Check not placed", ["Try a different span."], pr.message);
  }
}
function verifyToast(v, scored) {
  const why = v.messages.join(" ");
  const tail = scored ? "Not scored yet. " : "";
  if (v.passed) return toast("success", "Verify passed", ["No check flags a clean run.", "Now press TEST UNDER NOISE."]);
  if (v.conflicts && v.conflicts.length) {
    const [i, j] = v.conflicts[0];
    return toast("error", `Checks ${LETTERS[i]} and ${LETTERS[j]} clash`, [`${tail}Together they flag clean runs.`, "Move or remove one, then VERIFY again."], why);
  }
  const firing = (v.fire_probs || []).findIndex((p) => p > 1e-9);
  if (firing >= 0) return toast("error", `Check ${LETTERS[firing]} flags clean runs`, [`${tail}It flags ${pct(v.fire_probs[firing], 0)} of runs with no noise.`, "Move or remove it."], why);
  return toast("error", "Output changed", [`${tail}With no noise, the result is wrong.`, "Change or remove a check."], why);
}
const problemsToast = (problems) => toast("error", "Layout not valid", [problems[0]], problems.length > 1 ? problems.join(" ") : null);

/* ------------------------------------------------------------------ rendering */

function render() {
  if (S.view === "select") renderSelect();
  else if (S.view === "puzzle") renderPuzzle();
  else renderResults();
  renderStrip();
  renderLayer();
  const blocking = !!(S.modal || S.print);
  $view.inert = blocking;
  $strip.inert = blocking;
  tourSync();
  requestAnimationFrame(() => { positionAnchored(); renderTour(); });
}

function plaque(eyebrow, title) {
  return `<div class="plaque bevel"><div class="eb">${esc(eyebrow)}</div><div class="tt">${esc(title)}</div></div>`;
}
const menuButton = () => `<button type="button" class="sbtn bevel" data-menu aria-haspopup="true" aria-expanded="${S.menu}" aria-label="Menu" title="Menu">☰</button>`;

function renderStrip() {
  let right = "";
  if (S.view === "puzzle") {
    const r = S.result;
    const led = !r ? "" : !r.valid || !(r.verify && r.verify.passed) ? "red" : "green";
    const nudge = r && r.verifyOnly && r.valid && r.verify && r.verify.passed;
    right = `<div class="group">
      <button type="button" class="pbtn" data-verify ${S.busy ? "disabled" : ""}><span class="pled ${led}" aria-hidden="true"></span>VERIFY<span class="sr-only">${led === "green" ? " (passed)" : led === "red" ? " (needs fix)" : " (not verified)"}</span></button>
      <button type="button" class="pbtn" data-run ${S.busy ? "disabled" : ""}><span class="pled ${nudge ? "amber blink" : ""}" aria-hidden="true"></span>TEST UNDER NOISE</button></div>`;
  } else if (S.view === "results") {
    const idx = S.levels.findIndex((x) => x.id === S.level.id);
    const next = S.levels[idx + 1];
    right = `<div class="group"><button type="button" class="pbtn" data-home>PUZZLE LIST</button><button type="button" class="pbtn" data-back>EDIT LAYOUT</button></div>
      <div class="group"><button type="button" class="pbtn" data-print="report">RUN REPORT</button><button type="button" class="pbtn" data-print="lesson">LESSON</button>${S.series ? `<button type="button" class="pbtn" data-print="tcount">T-COUNT STUDY</button>` : ""}</div>
      ${next ? `<button type="button" class="pbtn" data-next data-level="${esc(next.id)}"><span class="pled amber" aria-hidden="true"></span>NEXT PUZZLE</button>` : `<button type="button" class="pbtn" data-next data-home>FINISH</button>`}`;
  }
  // The manual button sits on the bezel on every screen. Until the manual has been opened once, its LED blinks and,
  // on the puzzle list, a sticky note points at it.
  const unread = !PREFS.manualOpened;
  const manual = `<button type="button" class="pbtn" data-manual title="Open the user manual in a new tab"><span class="pled ${unread ? "amber blink" : ""}" aria-hidden="true"></span>MANUAL</button>`
    + (unread && S.view === "select" ? `<span class="sticky" aria-hidden="true">&lt;-- READ ME FIRST!</span>` : "");
  // The results strip after the T-count study has one button more; the decorative badge makes room for it at 1280 px.
  const badge = S.view === "results" && S.series ? "" : `<span class="badge" aria-hidden="true">CHECKPOINT</span>`;
  $strip.innerHTML = `${badge}<span class="power" aria-hidden="true"></span>${manual}<span class="spacer"></span>${right}`;
}
function openManual() {
  window.open("/manual", "_blank", "noopener");
  if (!PREFS.manualOpened) setPref("manualOpened", true);
  render();
}

/* ------------------------------------------------------------------ title screen */

function renderSelect() {
  const tile = (lv) => {
    const st = status(lv.id);
    const led = st === "solved" ? "green" : st === "tried" ? "yellow" : "red";
    const tag = st === "solved" ? "SOLVED" : st === "tried" ? "TRIED" : "NOT TRIED";
    return `<button type="button" class="ptile bevel" data-level="${esc(lv.id)}" aria-label="Puzzle ${esc(lv.id)}: ${esc(lv.title)}. ${tag.toLowerCase()}.">
      <span class="led ${led}" aria-hidden="true"></span>
      <span class="num">PUZZLE ${esc(lv.id)}</span>
      <span class="name">${esc(lv.title)}</span>
      <span class="foot"><span>${tag}</span>${lv.t_count ? `<span class="chip-t">${lv.t_count} T/T†</span>` : ""}</span>
    </button>`;
  };
  let grid = "";
  for (let i = 0; i < S.levels.length;) {
    const lv = S.levels[i];
    if (!lv.series) { grid += tile(lv); i++; continue; }
    const group = [];
    while (i < S.levels.length && S.levels[i].series === lv.series) group.push(S.levels[i++]);
    const copy = SERIES_COPY[lv.series] || { title: `${lv.series.toUpperCase()} SERIES`, text: "" };
    // A series of four sits as a 2 x 2 block, three columns wide and two rows tall, so 15 puzzles fit in three rows.
    const square = group.length === 4;
    grid += `<section class="series" style="${square ? "grid-column: span 3; grid-row: span 2" : `grid-column: span ${group.length}`}" aria-label="${esc(copy.title)}">
      <div class="plate">${esc(copy.title)}<button type="button" class="sbtn bevel" data-info="series:${esc(lv.series)}" aria-label="About the ${esc(copy.title)}">?</button></div>
      <div class="inner" style="grid-template-columns: repeat(${square ? 2 : group.length}, minmax(0, 1fr))">${group.map(tile).join("")}</div></section>`;
  }
  $view.innerHTML = `
    <div class="hdr">${plaque("QISKIT FALL FEST 2026 · ERROR DETECTION", "Choose a puzzle")}<div class="right">${menuButton()}</div></div>
    <main class="select">
      <div class="tiles">${grid}</div>
      <div class="infoline" id="infoline" aria-live="polite">${defaultInfoline()}</div>
    </main>`;
}
const defaultInfoline = () => "<b>SELECT A PUZZLE.</b> LED: red not tried · yellow tried · green solved.";
function infolineFor(id) {
  const lv = S.levels.find((x) => x.id === id);
  if (!lv) return defaultInfoline();
  const b = loadBest()[id];
  return `<b>PUZZLE ${esc(lv.id)}</b> ${esc(lv.lesson)}${b ? ` <b>· BEST</b> F ${f3(b.fidelity)} · Y ${pct(b.yield)}` : ""}`;
}

/* ------------------------------------------------------------------ puzzle screen */

async function openLevel(id) {
  S.busy = true;
  S.level = await API.get(`/api/levels/${encodeURIComponent(id)}`);
  Object.assign(S, { checks: [], pending: null, result: null, landscape: null, series: null, blocked: null, openCheck: null, menu: false, codeOpen: false, print: null, tour: null });
  S.tool = S.level.tutorial ? S.level.tutorial.pauli : S.level.parts.paulis[0];
  await refreshPreview();
  clearToasts();
  S.view = "puzzle";
  S.modal = "about";
  S.startTourAfterAbout = !!TOURS[S.level.id] && !(PREFS.tourDone || {})[S.level.id];
  S.busy = false;
  render();
}

function slotRange() {
  const M = S.level.moments.length;
  const s = S.level.slots || {};
  return [s.min ?? 0, s.max ?? M];
}

function geom() {
  const L = S.level;
  const n = L.n_qubits, M = L.moments.length;
  const nAnc = Math.max(S.checks.length + (S.pending ? 1 : 0), L.budget.ancillas);
  const SLOT = Math.max(112, Math.min(210, Math.round(980 / M)));
  const LEFT = 86, X0 = LEFT + 54, TOP = 34, RH = 92, AH = 64, SW = 50;
  const xs = (k) => X0 + k * SLOT;
  const xm = (m) => X0 + m * SLOT + SLOT / 2;
  const yq = (q) => TOP + 50 + q * RH;
  const ya = (i) => yq(n - 1) + 92 + i * AH;
  const readX = xs(M) + 74;
  const W = readX + 100;
  const H = (nAnc ? ya(nAnc - 1) : yq(n - 1)) + 52;
  return { n, M, nAnc, SLOT, LEFT, X0, TOP, RH, AH, SW, xs, xm, yq, ya, readX, W, H };
}

function tile(x, y, w, h, fill = C.bone) {
  return `<rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" fill="${C.ink}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>
    <rect x="${x}" y="${y}" width="${w}" height="3" fill="${C.hi}"/><rect x="${x}" y="${y}" width="3" height="${h}" fill="${C.hi}"/>
    <rect x="${x}" y="${y + h - 3}" width="${w}" height="3" fill="${C.lo}"/><rect x="${x + w - 3}" y="${y}" width="3" height="${h}" fill="${C.lo}"/>
    ${w > 30 ? `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="none" stroke="${C.engrave}" stroke-width="1"/>` : ""}`;
}
const txt = (x, y, s, size, color = C.ink, font = "Silk", anchor = "middle") =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" fill="${color}">${s}</text>`;
const ledRect = (x, y, color, fast, delay = 0) =>
  `<rect class="${fast ? "blink-fast" : "blink"}" style="animation-delay:${delay}s" x="${x}" y="${y}" width="8" height="8" fill="${color}" filter="url(#glow)"/>`;
const pulse = (x1, x2, y, grad, dur, begin) => (REDUCED ? "" :
  `<rect y="${y - 3}" width="52" height="6" fill="url(#${grad})" filter="url(#glow)"><animate attributeName="x" from="${x1 - 56}" to="${x2}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></rect>`);

function gateNoise(m, gi) {
  const g = (S.level.gate_noise || []).find((x) => x.moment === m && x.index === gi);
  return g ? g.p : 0;
}

function gateSVG(g, m, gi, G) {
  const [name, qs] = g;
  const x = G.xm(m);
  const blockedHere = S.blocked && S.blocked[0] === m && qs.includes(S.blocked[1]);
  let o = "";
  if (qs.length === 1) {
    const y = G.yq(qs[0]);
    const isT = name === "t" || name === "tdg";
    o += tile(x - 30, y - 30, 60, 60, isT ? "#ddd0ea" : C.bone);
    if (isT) o += `<rect x="${x - 24}" y="${y - 24}" width="48" height="48" fill="url(#hatch)"/>`;
    o += txt(x, y + 9, GATE_LABEL[name] || name, 24, isT ? C.violet : C.ink);
    o += ledRect(x + 18, y - 24, blockedHere ? C.red : C.green, blockedHere, (m * 0.37) % 1.6);
    if (blockedHere) o += `<rect x="${x - 40}" y="${y - 40}" width="80" height="80" fill="none" stroke="${C.red}" stroke-width="4" filter="url(#glow)"/>`;
    return o;
  }
  const [a, b] = qs;
  const ya = G.yq(a), yb = G.yq(b), top = Math.min(ya, yb), bot = Math.max(ya, yb);
  o += `<rect x="${x - 6}" y="${top}" width="12" height="${bot - top}" fill="${C.ink}"/><rect x="${x - 4}" y="${top}" width="8" height="${bot - top}" fill="#d9c79f"/>`;
  const ctrl = (y) => tile(x - 20, y - 20, 40, 40) + `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${C.ink}"/>`;
  const p = gateNoise(m, gi);
  const hot = p > 0 && p >= 2 * S.level.noise_params.p2;
  if (name === "cx") {
    o += ctrl(ya) + tile(x - 30, yb - 30, 60, 60) + `<rect x="${x - 14}" y="${yb - 2}" width="28" height="4" fill="${C.ink}"/><rect x="${x - 2}" y="${yb - 14}" width="4" height="28" fill="${C.ink}"/>`;
  } else if (name === "cz") {
    o += ctrl(ya) + ctrl(yb);
  } else if (name === "cy") {
    o += ctrl(ya) + tile(x - 30, yb - 30, 60, 60) + txt(x, yb + 9, "Y", 24);
  } else if (name === "swap") {
    for (const y of [ya, yb]) o += tile(x - 20, y - 20, 40, 40) + txt(x, y + 7, "✕", 18);
  }
  o += ledRect(x + 18, yb - 24, hot ? C.hot : C.green, hot, (m * 0.41) % 1.6);
  if (p > 0) {
    const cov = S.checks.length && S.preview && (S.preview.coverage || []).find((c) => c.moment === m && c.index === gi);
    const seen = cov ? Math.round(cov.seen * 100) : null;
    const bx = x + 38, h = seen == null ? 24 : 42, by = (ya + yb) / 2 - h / 2;
    (G.badges || (G.badges = [])).push([bx, by, bx + 72, by + h]);
    const tag = G.badges.length === 1 ? 'data-tour="badge"' : "";
    o += `<g ${tag}><title>Estimated error probability used by this puzzle's simulation: ${(p * 100).toFixed(1)}%.${seen == null ? "" : ` Your checks would flag ${seen}% of this gate's possible errors.`}</title><rect x="${bx}" y="${by}" width="72" height="${h}" fill="${hot ? C.hot : "#2a2119"}" stroke="${C.ink}" stroke-width="2"/>`
      + txt(bx + 36, by + 17, (p * 100).toFixed(1) + "%", 15, hot ? "#2a0d04" : "#cbb88f", "Dep")
      + (seen == null ? "" : txt(bx + 36, by + 35, `${seen}% SEEN`, 12, hot ? "#2a0d04" : seen > 0 ? "#9fe6bf" : "#8a7a5c", "Dep")) + `</g>`;
  }
  if (blockedHere) o += `<rect x="${x - 40}" y="${G.yq(S.blocked[1]) - 40}" width="80" height="80" fill="none" stroke="${C.red}" stroke-width="4" filter="url(#glow)"/>`;
  return o;
}

function chip(x, y, P, col, style) {
  if (style === "hollow") {
    return `<rect x="${x - 17}" y="${y - 17}" width="34" height="34" fill="#2a2119" stroke="${col.ring}" stroke-width="3"/>` + txt(x, y + 7, P, 18, col.bright);
  }
  const dash = style === "pending" ? ` stroke-dasharray="4 3"` : "";
  return tile(x - 19, y - 19, 38, 38) + `<rect x="${x - 13}" y="${y - 13}" width="26" height="26" fill="none" stroke="${col.ring}" stroke-width="3"${dash}/>` + txt(x, y + 7, P, 18, col.text);
}

// A check's pipe takes the colour of its start-edge Pauli (the first one if the edge mixes types).
const checkColor = (paulis) => PAULI[Object.values(paulis || {})[0]] || PAULI.Z;

function pipe(x1, x2, y, col) {
  let o = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#14100c" stroke-width="22"/>`;
  for (const [dy, c] of [[-6, col.dark], [0, col.bright], [6, col.dark]]) o += `<line x1="${x1}" y1="${y + dy}" x2="${x2}" y2="${y + dy}" stroke="${c}" stroke-width="3"/>`;
  return o;
}

// One edge of a check: the brass rod and connector to the ancilla pipe, then the Pauli chips.
function edgeSVG(G, x, ya, paulis, col, style, withRod) {
  const qs = Object.keys(paulis || {}).map(Number);
  if (!qs.length) return "";
  let o = "";
  if (withRod) {
    const top = G.yq(Math.min(...qs));
    o += `<rect x="${x - 5}" y="${top}" width="10" height="${ya - top}" fill="${C.ink}"/><rect x="${x - 3}" y="${top}" width="6" height="${ya - top}" fill="#c7a764"/>`;
    o += tile(x - 15, ya - 15, 30, 30) + `<rect x="${x - 5}" y="${ya - 5}" width="10" height="10" fill="${C.ink}"/>`;
  }
  for (const q of qs) o += chip(x, G.yq(q), paulis[q], col, style);
  return o;
}

function checkBodySVG(c, i, G, bad) {
  const col = bad ? PAULI.bad : checkColor(c.paulis);
  const xl = G.xs(c.left), y = G.ya(i);
  const endX = c.merged ? xl + 46 : G.xs(c.right);
  let o = pipe(xl - 62, endX + 48, y, col) + pulse(xl - 62, endX + 40, y, col.grad, 2.2, -i * 0.7);
  o += tile(xl - 114, y - 17, 52, 34) + txt(xl - 88, y + 6, "|+⟩", 15, C.ink, "Dep");
  o += tile(endX + 48, y - 17, 50, 34) + txt(endX + 73, y + 6, "Mx", 15, C.ink, "Dep") + ledRect(endX + 86, y - 13, col.bright, bad, 0.2);
  o += `<rect x="${xl + 14}" y="${y - 40}" width="${c.merged ? 150 : 92}" height="20" fill="#1e2a26" stroke="${col.bright}" stroke-width="2"/>` + txt(xl + 22, y - 25, `CHECK ${LETTERS[i]}${c.merged ? " · READOUT" : ""}`, 13, col.bright, "Dep", "start");
  if (c.merged) {
    for (const q of Object.keys(c.right_paulis || {}).map(Number)) {
      o += `<line x1="${G.xs(c.right) + 18}" y1="${G.yq(q)}" x2="${G.readX - 34}" y2="${G.yq(q)}" stroke="${col.bright}" stroke-width="3" stroke-dasharray="3 5"/>`;
    }
  }
  return o;
}

function checkEdgesSVG(c, i, G, bad) {
  const col = bad ? PAULI.bad : checkColor(c.paulis);
  const y = G.ya(i), xr = G.xs(c.right);
  let o = edgeSVG(G, G.xs(c.left), y, c.paulis, col, "solid", true);
  o += edgeSVG(G, xr, y, c.right_paulis, col, c.merged ? "hollow" : "solid", !c.merged);
  if (c.sign < 0 && c.right_paulis) {
    const top = Math.min(...Object.keys(c.right_paulis).map(Number));
    o += `<rect x="${xr + 20}" y="${G.yq(top) - 40}" width="34" height="20" fill="#1e2a26" stroke="${col.bright}" stroke-width="2"/>` + txt(xr + 37, G.yq(top) - 25, "−1", 13, col.bright, "Dep");
  }
  return o;
}

// What a check flags where its Pauli is P: errors that anticommute with P on that qubit.
const CATCHES = { Z: "X Y", X: "Z Y", Y: "X Z" };

// The wire pieces a check watches: from each slot to the next gate it uses the Pauli at that slot,
// from the gate to the next slot the Pauli after the gate. Returns [x1, x2, qubit, pauli].
function watchSegments(c, G) {
  const t = c.trail || [];
  const seg = [];
  for (let k = c.left; k < c.right; k++) {
    for (const [x1, x2, j] of [[G.xs(k), G.xm(k), k - c.left], [G.xm(k), G.xs(k + 1), k + 1 - c.left]]) {
      for (const [q, P] of Object.entries(t[j] || {})) seg.push([x1, x2, Number(q), P]);
    }
  }
  return seg;
}

function glowSVG(c, G, col) {
  return watchSegments(c, G).map(([x1, x2, q]) =>
    `<line x1="${x1}" y1="${G.yq(q)}" x2="${x2}" y2="${G.yq(q)}" stroke="${col.bright}" stroke-width="12" stroke-opacity="0.32"/>`).join("");
}

// Faint chips for the check's Pauli at every slot strictly inside its span.
function trailSVG(c, G, col, used) {
  let o = "";
  const t = c.trail || [];
  for (let k = c.left + 1; k < c.right; k++) {
    for (const [q, P] of Object.entries(t[k - c.left] || {})) {
      const key = `${k}:${q}`, dx = (used[key] || 0) * 26;
      used[key] = (used[key] || 0) + 1;
      o += `<rect x="${G.xs(k) - 13 + dx}" y="${G.yq(q) - 13}" width="26" height="26" fill="#2a2119" stroke="${col.ring}" stroke-width="2" opacity="0.9"/>` + txt(G.xs(k) + dx, G.yq(q) + 6, P, 15, col.bright);
    }
  }
  return o;
}

// For the check whose panel is open: one tag per stretch of wire saying which errors it catches there.
function seesSVG(c, G, col) {
  const runs = [];
  for (const [x1, x2, q, P] of watchSegments(c, G)) {
    const last = runs.find((r) => r.q === q && r.P === P && Math.abs(r.x2 - x1) < 1);
    if (last) last.x2 = x2; else runs.push({ x1, x2, q, P });
  }
  const hits = (x, y) => (G.badges || []).some(([a, b, c2, d]) => x + 40 > a && x - 40 < c2 && y + 6 > b && y - 13 < d);
  return runs.map((r) => {
    const x = (r.x1 + r.x2) / 2, label = `SEES ${CATCHES[r.P]}`;
    const y = [G.yq(r.q) - 30, G.yq(r.q) + 40, G.yq(r.q) - 52].find((yy) => !hits(x, yy)) ?? G.yq(r.q) - 30;
    return `<rect x="${x - 40}" y="${y - 13}" width="80" height="19" fill="#1e2a26" stroke="${col.bright}" stroke-width="1.5"/>` + txt(x, y + 1, label, 12, col.bright, "Dep");
  }).join("");
}

function endHandleSVG(c, i, G) {
  return `<g class="handle" data-endhandle="${i}" transform="translate(${G.xs(c.right)},${G.ya(i)})"><title>Drag to change where check ${LETTERS[i]} ends</title>
    <rect x="-20" y="-20" width="40" height="40" fill="transparent"/>${tile(-12, -12, 24, 24)}
    <path d="M -7 0 L -2 -5 L -2 5 Z M 7 0 L 2 -5 L 2 5 Z" fill="${C.ink}"/></g>`;
}

function pendingSVG(G) {
  const p = S.pending;
  const col = checkColor(p.paulis);
  const y = G.ya(S.checks.length);
  const [, hi] = slotRange();
  const xl = G.xs(p.left), xh = G.xs(Math.min(p.left + 1, hi));
  let o = `<line id="pend-pipe" x1="${xl - 62}" y1="${y}" x2="${xh}" y2="${y}" stroke="${col.bright}" stroke-width="6" stroke-dasharray="8 6" opacity="0.85"/>`;
  o += tile(xl - 114, y - 17, 52, 34) + txt(xl - 88, y + 6, "|+⟩", 15, C.ink, "Dep");
  const qs = Object.keys(p.paulis).map(Number);
  const top = G.yq(Math.min(...qs));
  o += `<rect x="${xl - 3}" y="${top}" width="6" height="${y - top}" fill="#c7a764" opacity="0.7"/>`;
  for (const q of qs) o += chip(xl, G.yq(q), p.paulis[q], col, "pending");
  return o;
}
function handleSVG(G) {
  const y = G.ya(S.checks.length);
  const [, hi] = slotRange();
  const xh = G.xs(Math.min(S.pending.left + 1, hi));
  return `<g id="handle" class="handle" data-handle transform="translate(${xh},${y})"><title>Drag to the slot where the check ends</title>
    <rect x="-24" y="-24" width="48" height="48" fill="transparent"/>${tile(-16, -16, 32, 32)}
    <path d="M -5 -8 L 7 0 L -5 8 Z" fill="${C.ink}"/>${REDUCED ? "" : `<rect x="-21" y="-21" width="42" height="42" fill="none" stroke="${C.hi}" stroke-width="2" class="blink"/>`}</g>`;
}

function troubledChecks() {
  const v = S.result && S.result.verify;
  const out = new Set();
  if (!v) return out;
  (v.fire_probs || []).forEach((p, i) => { if (p > 1e-9) out.add(i); });
  (v.conflicts || []).forEach(([i, j]) => { out.add(i); out.add(j); });
  return out;
}

function boardSVG() {
  const L = S.level;
  const G = geom();
  const [lo, hi] = slotRange();
  const bad = troubledChecks();
  const t = L.tutorial;
  let o = `<svg id="board" viewBox="0 0 ${G.W} ${G.H}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img"
    aria-label="Circuit board for puzzle ${esc(L.id)}: ${G.n} qubits, ${G.M} gate columns, ${plural(S.checks.length, "check")} placed.">`;
  o += `<defs>
    <filter id="glow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    ${[["pulse", "#ffe3a3"], ["pulseZ", "#9ffbe0"], ["pulseX", "#c4dcff"], ["pulseY", "#fff0a8"], ["pulseRed", "#ffb3a6"]].map(([id, c]) =>
      `<linearGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="#ffffff" stop-opacity=".25"/></linearGradient>`).join("")}
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="8" fill="rgba(107,74,154,0.18)"/></pattern>
  </defs>`;
  for (let k = 0; k <= G.M; k++) {
    const ok = k >= lo && k <= hi;
    o += `<rect x="${G.xs(k) - 1}" y="${G.TOP + 8}" width="2" height="${G.H - G.TOP - 16}" fill="${ok ? "#3c3023" : "#5c2c22"}"/>`;
    o += txt(G.xs(k), G.TOP, String(k), 16, ok ? "#c4b089" : "#b0634f", "Dep");
  }
  for (let q = 0; q < G.n; q++) {
    const y = G.yq(q);
    o += `<line x1="${G.LEFT - 12}" y1="${y}" x2="${G.readX - 34}" y2="${y}" stroke="#0e0a07" stroke-width="16"/><line x1="${G.LEFT - 12}" y1="${y}" x2="${G.readX - 34}" y2="${y}" stroke="#2a2119" stroke-width="4"/>`;
    o += pulse(G.LEFT, G.readX - 40, y, "pulse", 3.2 + 0.25 * G.M / 4, -q * 0.9);
    o += tile(10, y - 18, G.LEFT - 22, 36) + txt(10 + (G.LEFT - 22) / 2, y + 7, `q${q}`, 17);
  }
  const colOf = (c, i) => (bad.has(i) ? PAULI.bad : checkColor(c.paulis));
  S.checks.forEach((c, i) => { o += glowSVG(c, G, colOf(c, i)) + checkBodySVG(c, i, G, bad.has(i)); });
  L.moments.forEach((moment, m) => moment.forEach((g, gi) => { o += gateSVG(g, m, gi, G); }));
  const used = {};
  S.checks.forEach((c, i) => { o += trailSVG(c, G, colOf(c, i), used) + checkEdgesSVG(c, i, G, bad.has(i)); }); // edges sit on top of the gates
  if (S.openCheck != null && S.checks[S.openCheck]) o += seesSVG(S.checks[S.openCheck], G, colOf(S.checks[S.openCheck], S.openCheck));
  if (S.pending) o += pendingSVG(G);
  for (let q = 0; q < G.n; q++) {
    const ro = (L.readout || [])[q] || 0;
    o += tile(G.readX - 32, G.yq(q) - 22, 64, 44) + txt(G.readX, G.yq(q) + 7, "M", 18);
    o += txt(G.readX + 42, G.yq(q) + 5, (ro * 100).toFixed(1) + "%", 14, ro >= 0.02 ? C.hot : "#b9a57c", "Dep", "start");
  }
  // Invisible tour targets, then the hit areas for slots and placed checks.
  o += `<rect class="tour-target" data-tour="readout" x="${G.readX - 40}" y="${G.yq(0) - 34}" width="128" height="${G.yq(G.n - 1) - G.yq(0) + 68}"/>`;
  if (t) {
    o += `<rect class="tour-target" data-tour="start" x="${G.xs(t.start) - 34}" y="${G.yq(t.qubit) - 34}" width="68" height="68"/>`;
    o += `<rect class="tour-target" data-tour="end" x="${G.xs(t.end) - 34}" y="${G.yq(t.qubit) - 34}" width="68" height="68"/>`;
  }
  for (let k = 0; k <= G.M; k++) {
    const ok = k >= lo && k <= hi;
    for (let q = 0; q < G.n; q++) {
      o += `<rect class="slot-hit ${ok ? "" : "disabled"}" data-slot="${k}" data-q="${q}" x="${G.xs(k) - G.SW / 2}" y="${G.yq(q) - G.RH / 2}" width="${G.SW}" height="${G.RH}"><title>slot ${k}, qubit ${q}</title></rect>`;
    }
  }
  S.checks.forEach((c, i) => {
    const x1 = G.xs(c.left) - 114, x2 = (c.merged ? G.xs(c.left) + 46 : G.xs(c.right)) + 98;
    o += `<rect class="check-hit" data-checkopen="${i}" x="${x1}" y="${G.ya(i) - 26}" width="${x2 - x1}" height="52"><title>Check ${LETTERS[i]}: click for details</title></rect>`;
  });
  S.checks.forEach((c, i) => { o += endHandleSVG(c, i, G); });
  if (S.pending) o += handleSVG(G);
  return o + `</svg>`;
}

function rackHTML() {
  const allowed = S.level.parts.paulis;
  const tool = (key, glyph, label, cls) => `<button type="button" class="tool ${cls} ${S.tool === key ? "active" : ""}" data-tool="${key}" aria-pressed="${S.tool === key}"
      aria-label="${label}${key === "erase" ? ": drag onto a check, or select then click a check" : ": drag onto the board, or select then click a slot"}">
      <span class="face bevel"><span class="glyph" style="${key === "erase" ? "font-size:18px" : ""}">${glyph}</span><span class="led"></span></span><span class="tag">${label}</span></button>`;
  let o = "";
  for (const p of ["Z", "X", "Y"]) if (allowed.includes(p)) o += tool(p, p, `${p} CHECK`, p.toLowerCase());
  return o + tool("erase", "✕", "REMOVE", "rm");
}

function highlightCode(src) {
  return src.split("\n").map((line) => {
    const e = esc(line);
    if (line.trim().startsWith("#")) return `<span class="cm">${e}</span>`;
    if (/qc\.(t|tdg)\(/.test(line)) return `<span class="tg">${e}</span>`;
    if (/a\[\d+\]/.test(line)) return `<span class="ck">${e}</span>`;
    return e.replace(/^(qc\.)(\w+)/, '$1<span class="kw">$2</span>');
  }).join("\n");
}

function renderPuzzle() {
  const L = S.level;
  $view.innerHTML = `
    <div class="hdr">${plaque(`PUZZLE ${L.id}${L.t_count ? ` · ${L.t_count} T/T† GATES` : " · CLIFFORD"}`, L.title)}</div>
    <div class="stage">
      <aside class="rack" aria-label="Check pieces">${rackHTML()}</aside>
      <div class="boardframe bevel"><div class="boardbox" data-tour="board">${boardSVG()}</div></div>
      <div class="rail">
        ${menuButton()}
        <button type="button" class="sbtn bevel" data-modal="hint" aria-label="Show hint" title="Hint">?</button>
        <button type="button" class="sbtn ibtn bevel" data-modal="about" aria-label="About the puzzle" title="About the puzzle">i</button>
        <button type="button" class="sbtn redbtn" data-solution aria-label="See the solution" title="See the solution">!</button>
        <button type="button" class="tab bevel" data-code aria-expanded="${S.codeOpen}" aria-label="Qiskit circuit code"><span>CODE</span></button>
      </div>
      ${S.codeOpen ? `<section class="phos drawer" aria-label="Qiskit circuit code for this board">
        <div class="bar"><span class="ttl">CIRCUIT CODE</span><button type="button" class="qbtn" data-code aria-label="Close code">✕</button></div>
        <pre>${highlightCode((S.preview && S.preview.code) || "")}</pre></section>` : ""}
    </div>`;
}

async function refreshPreview() {
  const body = { level_id: S.level.id, checks: S.checks.map(({ left, right, paulis, merge }) => ({ left, right, paulis, merge })) };
  S.preview = await API.post("/api/preview", body);
  S.preview.checks.forEach((pc, i) => {
    Object.assign(S.checks[i], { right_paulis: pc.right_paulis, sign: pc.sign, can_merge: pc.can_merge, merged: pc.merged, trail: pc.trail || [] });
  });
}

function boardChanged() { S.result = null; S.blocked = null; clearToasts("error"); }

async function onSlot(k, q, P) {
  if (P === "erase" || S.busy) return;
  const L = S.level;
  const [lo, hi] = slotRange();
  if (k < lo || k > hi) { toast("error", "Slot not allowed", [`This puzzle uses slots ${lo} to ${hi}.`]); return; }
  if (!S.pending) {
    if (k >= hi) { toast("error", "No room to the right", ["A check needs at least one gate.", "Start it at an earlier slot."]); return; }
    if (S.checks.length >= L.budget.ancillas) { toast("error", "No checks left", [`This puzzle allows ${plural(L.budget.ancillas, "check")}.`, "Remove one to add another."]); return; }
    clearToasts("error");
    S.pending = { left: k, paulis: { [q]: P } };
    S.openCheck = null;
    return render();
  }
  if (k === S.pending.left) {
    if (S.pending.paulis[q] === P) delete S.pending.paulis[q];
    else {
      if (!(q in S.pending.paulis) && Object.keys(S.pending.paulis).length >= L.parts.max_weight) {
        toast("error", "Start edge is full", [`A check can start on ${plural(L.parts.max_weight, "qubit")} at most.`]);
        return;
      }
      S.pending.paulis[q] = P;
    }
    if (!Object.keys(S.pending.paulis).length) S.pending = null;
    return render();
  }
  if (k < S.pending.left) { S.pending = { left: k, paulis: { [q]: P } }; return render(); }
  const chk = { left: S.pending.left, right: k, paulis: { ...S.pending.paulis } };
  const pr = await API.post("/api/propagate", { level_id: L.id, check: chk });
  if (!pr.ok) { S.blocked = pr.blocked_at; render(); propagateToast(pr); return; }
  boardChanged();
  S.checks.push({ ...chk, merge: null });
  S.pending = null;
  await refreshPreview();
  render();
}

async function setEnd(i, k) {
  const c = S.checks[i];
  const pr = await API.post("/api/propagate", { level_id: S.level.id, check: { left: c.left, right: k, paulis: c.paulis } });
  if (!pr.ok) { S.blocked = pr.blocked_at; render(); propagateToast(pr); return; }
  boardChanged();
  Object.assign(c, { right: k, merge: null });
  await refreshPreview();
  render();
}

async function removeCheck(i) {
  S.checks.splice(i, 1);
  S.openCheck = null;
  boardChanged();
  await refreshPreview();
  render();
}

async function clearBoard() {
  S.checks = []; S.pending = null; S.openCheck = null;
  boardChanged();
  await refreshPreview();
  render();
  toast("info", "Board cleared", ["Back to the circuit with no checks."]);
}

async function evaluate() {
  S.busy = true; render();
  try {
    const body = { level_id: S.level.id, checks: S.checks.map(({ left, right, paulis, merge }) => ({ left, right, paulis, merge })) };
    S.result = await API.post("/api/evaluate", body);
  } finally { S.busy = false; }
  return S.result;
}

async function onVerify() {
  clearToasts("error");
  const r = await evaluate();
  r.verifyOnly = true; // Verify is the noiseless check; noisy metrics appear only after a noise test
  render();
  if (!r.valid) problemsToast(r.problems);
  else verifyToast(r.verify, false);
}

function lastInSeries(lv) {
  const group = S.levels.filter((x) => x.series && x.series === lv.series);
  return group.length > 0 && group[group.length - 1].id === lv.id;
}

async function onRun() {
  clearToasts("error");
  const r = await evaluate();
  if (!r.valid) { render(); problemsToast(r.problems); return; }
  if (!r.verify.passed) { render(); verifyToast(r.verify, true); return; }
  S.landscape = await API.get(`/api/landscape/${encodeURIComponent(S.level.id)}`);
  S.series = lastInSeries(S.level) ? await API.get(`/api/series/${encodeURIComponent(S.level.series)}`) : null;
  addHistory(S.level.id, r.metrics, !!r.goal.met);
  saveBest(S.level.id, r.metrics, !!r.goal.met);
  clearToasts();
  Object.assign(S, { view: "results", openCheck: null, menu: false, codeOpen: false });
  // (the puzzle's own tour ends as its results open, so only another tour holds the question back)
  if (S.level.id === RESULTS_TOUR_LEVEL && !PREFS.resultsTourOffered && (!S.tour || S.tour.name === S.level.id)) S.modal = "resultsPrompt";
  render();
}

/* ------------------------------------------------------------------ results screen */

// Histogram of every evaluated layout. Markers are drawn inside the bar their value falls in, stacked
// just above it (reference, then this run, then your best), so they can never drift off their bar.
// With a target, bin edges start at the target: every red bar is below it and every green bar at or
// above it (the target itself passes), and the dashed line sits in the gap between them.
function histogram(key, values, you, target, best, ref, lowerBetter, fmt, discrete = false) {
  const marked = [ref, you, best].filter((v) => v != null);
  let bins, idx;
  if (discrete) {
    const lo = Math.round(Math.min(...values, ...marked)), hi = Math.round(Math.max(...values, ...marked));
    bins = Array.from({ length: hi - lo + 1 }, (_, i) => ({ lo: lo + i, count: 0, label: String(lo + i) }));
    idx = (v) => Math.round(v) - lo;
  } else {
    let lo = Math.min(...values, ...marked, ...(target != null ? [target] : [])), hi = Math.max(...values, ...marked, ...(target != null ? [target] : []));
    if (hi - lo < 1e-9) { lo -= 0.005; hi += 0.005; }
    const w = (hi - lo) / 17;
    const start = target != null ? target - Math.ceil((target - lo) / w - 1e-9) * w : lo;
    const n = Math.max(1, Math.floor((hi - start) / w + 1e-9) + 1);
    bins = Array.from({ length: n }, (_, i) => ({ lo: start + i * w, hi: start + (i + 1) * w, count: 0 }));
    idx = (v) => Math.min(n - 1, Math.max(0, Math.floor((v - start) / w + 1e-9)));
  }
  values.forEach((v) => bins[idx(v)].count++);
  const max = Math.max(1, ...bins.map((b) => b.count));
  const stack = bins.map(() => []);
  if (ref != null) stack[idx(ref)].push(`<span class="mk ref">◆</span>`);
  stack[idx(you)].push(`<span class="mk you">▼</span>`);
  if (best != null) stack[idx(best)].push(`<span class="mk best">★</span>`);
  const pass = (b) => (target == null ? true : lowerBetter ? b.lo + 1e-12 <= target : b.lo >= target - 1e-12);
  const firstPass = target == null ? -1 : bins.findIndex(pass);
  const line = `<div class="tline" ${key === "fid" ? 'data-tour="line"' : ""} aria-hidden="true"></div>`;
  let cols = "";
  bins.forEach((b, i) => {
    if (i === firstPass) cols += line;
    cols += `<div class="col"><div class="stack">${stack[i].reverse().join("")}</div><div class="bar ${pass(b) ? "" : "fail"}" style="height:${b.count ? Math.max(1.5, (b.count / max) * 100) : 0.6}%" title="${b.count} evaluated layouts"></div></div>`;
  });
  if (target != null && firstPass === -1) cols += line;
  const axis = discrete
    ? `<div class="axis cols" aria-hidden="true">${bins.map((b) => `<span>${b.label}</span>`).join("")}</div>`
    : `<div class="axis" aria-hidden="true"><span>${fmt(bins[0].lo)}</span><span>${fmt(bins[bins.length - 1].hi)}</span></div>`;
  const beaten = values.filter((v) => (lowerBetter ? v > you + 1e-12 : v < you - 1e-12)).length;
  return { html: `<div class="histo" ${key === "fid" ? 'data-tour="marks"' : ""}><div class="bars">${cols}</div></div>${axis}`, beaten: values.length ? beaten / values.length : 0 };
}

function metricScreen(key, title, valueText, ok, targetText, hist, srText) {
  const cls = ok == null ? "neutral" : ok ? "ok" : "miss";
  return `<section class="phos" data-tour="${key}" aria-label="${esc(srText)}">
    <div class="bar"><span class="ttl">${title}</span><button type="button" class="qbtn" data-info="${key}" aria-label="About ${title.toLowerCase()}">?</button></div>
    <div class="valrow"><span class="val ${cls}">${valueText}</span>${ok == null ? "" : `<span class="mark ${cls}" aria-hidden="true">${ok ? "O" : "X"}</span>`}<span class="target">${targetText}</span></div>
    ${hist.html}</section>`;
}

function scopeSVG(points, front, you, par, base, past) {
  const W = 800, H = 300, x0 = 58, x1 = 784, y0 = 266, y1 = 14;
  const all = points.concat([you, base]).concat(par ? [par] : []).concat(past);
  let ylo = Math.min(...all.map((p) => p.yield)), yhi = Math.max(...all.map((p) => p.yield));
  let flo = Math.min(...all.map((p) => p.fidelity)), fhi = Math.max(...all.map((p) => p.fidelity));
  const padY = (yhi - ylo) * 0.05 || 0.01, padF = (fhi - flo) * 0.08 || 0.01;
  ylo -= padY; yhi = Math.min(1.0, yhi) + padY; flo -= padF; fhi += padF;
  const X = (v) => x0 + ((v - ylo) / (yhi - ylo)) * (x1 - x0);
  const Y = (v) => y0 - ((v - flo) / (fhi - flo)) * (y0 - y1);
  let o = `<svg viewBox="0 0 ${W} ${H + 22}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fidelity against yield. Your layout: fidelity ${f3(you.fidelity)}, yield ${pct(you.yield)}. Baseline: fidelity ${f3(base.fidelity)}, yield ${pct(base.yield)}.${par ? ` Reference: fidelity ${f3(par.fidelity)}, yield ${pct(par.yield)}.` : ""}">`;
  o += `<defs><filter id="sglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  for (let i = 0; i <= 4; i++) {
    const fv = flo + ((fhi - flo) * i) / 4, yv = ylo + ((Math.min(1, yhi) - ylo) * i) / 4;
    o += `<line x1="${x0}" y1="${Y(fv)}" x2="${x1}" y2="${Y(fv)}" stroke="${C.phosGrid}"/><line x1="${X(yv)}" y1="${y1}" x2="${X(yv)}" y2="${y0}" stroke="${C.phosGrid}"/>`;
    o += `<text x="${x0 - 6}" y="${Y(fv) + 4}" text-anchor="end" font-family="Dep" font-size="12" fill="${C.phos}">${fv.toFixed(3)}</text>`;
    o += `<text x="${X(yv)}" y="${y0 + 17}" text-anchor="middle" font-family="Dep" font-size="12" fill="${C.phos}">${(yv * 100).toFixed(0)}%</text>`;
  }
  o += `<text x="${x1}" y="${H + 18}" text-anchor="end" font-family="Dep" font-size="12" fill="${C.phos}">YIELD →</text><text x="${x0 + 6}" y="${y1 + 12}" font-family="Dep" font-size="12" fill="${C.phos}">FIDELITY ↑</text>`;
  const sample = points.length > 2500 ? points.filter((_, i) => i % Math.ceil(points.length / 2500) === 0) : points;
  o += `<g fill="${C.phosDim}">${sample.map((p) => `<circle cx="${X(p.yield).toFixed(1)}" cy="${Y(p.fidelity).toFixed(1)}" r="3"/>`).join("")}</g>`;
  const fp = front.map((i) => points[i]).sort((a, b) => a.yield - b.yield);
  if (fp.length) o += `<polyline data-tour="front" points="${fp.map((p) => `${X(p.yield).toFixed(1)},${Y(p.fidelity).toFixed(1)}`).join(" ")}" fill="none" stroke="${C.phosHi}" stroke-width="2.5" filter="url(#sglow)"/>`;
  o += past.map((p) => `<circle cx="${X(p.yield).toFixed(1)}" cy="${Y(p.fidelity).toFixed(1)}" r="5" fill="none" stroke="${C.yellow}" stroke-opacity="0.45" stroke-width="1.5"/>`).join("");
  o += `<circle cx="${X(base.yield)}" cy="${Y(base.fidelity)}" r="7" fill="none" stroke="${C.phosHi}" stroke-width="2"/><text x="${X(base.yield) - 11}" y="${Y(base.fidelity) - 10}" text-anchor="end" font-family="Dep" font-size="12" fill="${C.phosHi}">NO CHECKS</text>`;
  if (par) o += `<rect x="${X(par.yield) - 6}" y="${Y(par.fidelity) - 6}" width="12" height="12" transform="rotate(45 ${X(par.yield)} ${Y(par.fidelity)})" fill="${C.orange}"/><text x="${X(par.yield) + 11}" y="${Y(par.fidelity) + 18}" font-family="Dep" font-size="12" fill="${C.orange}">REFERENCE</text>`;
  o += `<circle class="blink" cx="${X(you.yield)}" cy="${Y(you.fidelity)}" r="8" fill="${C.yellow}" filter="url(#sglow)"/><text x="${X(you.yield) + 12}" y="${Y(you.fidelity) + (Y(you.fidelity) < y1 + 30 && X(you.yield) < x0 + 140 ? 22 : -9)}" font-family="Dep" font-size="13" fill="${C.yellow}">YOU</text>`;
  return o + `</svg>`;
}

function takeaway(r, land) {
  const m = r.metrics, b = r.baseline, g = r.goal;
  const par = r.par && r.par.available ? r.par.metrics : null;
  const parts = [];
  if (!m.ancillas) {
    parts.push(`This is the unprotected baseline: Fidelity is ${f3(b.fidelity)}, and all runs are kept because no checks reject any runs.`);
  } else {
    parts.push(`Without checks, Fidelity was ${f3(b.fidelity)}. Your layout has Fidelity ${f3(m.fidelity)} and keeps ${pct(m.yield)} of runs. It uses ${plural(m.ancillas, "ancilla")}, adds ${plural(m.extra_2q, "two-qubit gate")}, and adds ${plural(m.extra_depth, "layer")} of depth.`);
  }
  if (g.met) parts.push("You met both targets. Now look at Cost and the map: another layout may use fewer resources or keep more runs while still meeting the targets.");
  else if (g.fidelity_ok) parts.push("Fidelity meets the target, but Yield does not. Try a shorter span or remove a check that adds little detection value.");
  else if (g.yield_ok) parts.push("Yield meets the target, but Fidelity does not. Try a Pauli type that can flag the dominant errors, or move a check toward a noisier gate.");
  else parts.push("Neither target is met yet. First target the gates with the highest error rates; then check whether the Pauli type is able to detect those errors. Keep an eye on the Yield lost to extra checks.");
  const better = land.points.filter((p) => p.fidelity >= m.fidelity - 1e-9 && p.yield >= m.yield - 1e-9 && (p.fidelity > m.fidelity + 1e-9 || p.yield > m.yield + 1e-9)).length;
  let map = better
    ? `The search found ${plural(better, "evaluated layout")} that improve${better === 1 ? "s" : ""} both Fidelity and Yield compared with yours. Try one of those points, or use the map to understand the trade-off.`
    : "No layout in the evaluated set improves both Fidelity and Yield at once. Your point is on the trade-off frontier for this search. That does not prove it is globally optimal.";
  if (par) map += ` The automated reference has Fidelity ${f3(par.fidelity)} and Yield ${pct(par.yield)}. Compare both values, as well as Cost, before deciding which strategy is preferable.`;
  parts.push(map);
  return parts;
}

function resultsData() {
  const r = S.result, land = S.landscape, m = r.metrics, g = r.goal;
  const par = r.par && r.par.available ? r.par.metrics : null;
  const hist = loadHistory(S.level.id); // includes this run
  // Stars only count runs that met every target: a high Yield on a failed run is not a best.
  const solved = hist.filter((h) => h.met);
  const best = solved.length ? {
    fidelity: Math.max(...solved.map((h) => h.fidelity)),
    yield: Math.max(...solved.map((h) => h.yield)),
    cost: Math.min(...solved.map((h) => h.cost)),
  } : { fidelity: null, yield: null, cost: null };
  return { r, land, m, g, par, past: hist.slice(0, -1), best, pts: land.points };
}

// Every outcome of the data qubits: how often it appears with no checks and among the runs you kept.
// Wrong outcomes get bars scaled to the largest wrong share, so small differences stay visible.
function outputsScreen(rows) {
  const wrongMax = Math.max(1e-9, ...rows.filter((o) => !o.correct).flatMap((o) => [o.baseline, o.kept]));
  const cell = (o, v) => o.correct
    ? `<td class="num ok">${pct(v)}</td>`
    : `<td class="num"><span class="obar" style="width:${Math.round((v / wrongMax) * 60)}px"></span>${pct(v, 2)}</td>`;
  return `<section class="phos" data-tour="outputs"><div class="bar"><span class="ttl">OUTPUTS</span><button type="button" class="qbtn" data-info="outputs" aria-label="About outputs">?</button></div>
    <table class="cmp outputs"><thead><tr><th>RESULT</th><th>NO CHECKS</th><th>YOU KEPT</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="${o.correct ? "right" : "wrong"}"><td>${o.bits} <span class="mark ${o.correct ? "ok" : "miss"}">${o.correct ? "O" : "X"}</span></td>${cell(o, o.baseline)}${cell(o, o.kept)}</tr>`).join("")}
    </tbody></table></section>`;
}

function renderResults() {
  const L = S.level;
  const { r, land, m, g, par, past, best, pts } = resultsData();
  const b = r.baseline;
  const hf = histogram("fid", pts.map((p) => p.fidelity), m.fidelity, g.fidelity, best.fidelity, par && par.fidelity, false, (v) => v.toFixed(3));
  const hy = histogram("yld", pts.map((p) => p.yield), m.yield, g.min_yield, best.yield, par && par.yield, false, (v) => (v * 100).toFixed(0) + "%");
  const hc = histogram("cost", pts.map((p) => p.cost), m.cost, null, best.cost, par && par.cost, true, (v) => v.toFixed(0), true);
  S.percentiles = { fid: hf.beaten, yld: hy.beaten, cost: hc.beaten };
  const row = (name, x, cls) => `<tr class="${cls}"><td>${name}</td><td>${f3(x.fidelity)}</td><td>${pct(x.yield)}</td><td>${x.ancillas}</td><td>${x.extra_2q}</td><td>${x.extra_depth}</td></tr>`;
  $view.innerHTML = `
    <div class="hdr">${plaque(`PUZZLE ${L.id} · RESULTS`, L.title)}<div class="right"><button type="button" class="sbtn redbtn wide" data-solution aria-label="See the solution">SOLUTION</button>${menuButton()}</div></div>
    <main class="results">
      ${metricScreen("fid", "FIDELITY", f3(m.fidelity), g.fidelity_ok, `≥ ${f3(g.fidelity)}`, hf, `Fidelity ${f3(m.fidelity)}, target ${f3(g.fidelity)}, ${g.fidelity_ok ? "met" : "missed"}`)}
      ${metricScreen("yld", "YIELD", pct(m.yield), g.yield_ok, `≥ ${pct(g.min_yield)}`, hy, `Yield ${pct(m.yield)}, target ${pct(g.min_yield)}, ${g.yield_ok ? "met" : "missed"}`)}
      ${metricScreen("cost", "COST", String(m.cost), null, `${m.ancillas} ANC + ${m.extra_2q} 2Q`, hc, `Cost ${m.cost}: ${m.ancillas} ancillas and ${m.extra_2q} extra two-qubit gates`)}
      <section class="phos span2 scope" data-tour="scope"><div class="bar"><span class="ttl">FIDELITY VS YIELD</span><button type="button" class="qbtn" data-info="scope" aria-label="About this chart">?</button></div>
        ${scopeSVG(pts, land.pareto, m, par, b, past)}</section>
      ${L.show_outputs ? outputsScreen(r.outputs || []) : `<section class="phos" data-tour="table"><div class="bar"><span class="ttl">COMPARISON</span><button type="button" class="qbtn" data-info="table" aria-label="About this table">?</button></div>
        <table class="cmp"><thead><tr><th></th><th>F</th><th>Y</th><th>ANC</th><th>+2Q</th><th>+DEPTH</th></tr></thead><tbody>
        ${row("NO CHECKS", b, "")}${par ? row("REFERENCE", par, "ref") : `<tr class="ref"><td>REFERENCE</td><td colspan="5">n/a</td></tr>`}${row("YOU", m, "you")}
        </tbody></table></section>`}
    </main>`;
}

/* ------------------------------------------------------------------ windows, menu, check panel, printouts */

function win(title, body, actions, small = false, closeAttr = "data-close") {
  const size = small === "wide" ? "wide" : small ? "small" : "";
  return `<div class="backdrop" data-backdrop><div class="window bevel ${size}" role="dialog" aria-modal="true" aria-labelledby="win-title">
    <div class="wbar"><h2 id="win-title">${esc(title)}</h2><button type="button" class="x" ${closeAttr} aria-label="Close">✕</button></div>
    <div class="wbody">${body}</div><div class="wact">${actions}</div></div></div>`;
}
const okButton = (label = "OK") => `<button type="button" class="wbtn bevel go" data-close data-autofocus>${label}</button>`;

function aboutBody() {
  const L = S.level, g = L.goal;
  const targets = g.beat_par
    ? `Meet or beat the reference: Fidelity ≥ ${f3(g.fidelity)}, Yield ≥ ${pct(g.min_yield)}.`
    : `Fidelity ≥ ${f3(g.fidelity)}, Yield ≥ ${pct(g.min_yield)}.`;
  const cr = L.correct || {};
  const correct = cr.single ? `Always ${cr.single}.` : (cr.rules || []).map((r) => r.text).join(" · ")
    + ((cr.random || []).length ? ` · ${cr.random.map((q) => `q${q}`).join(", ")} ${cr.random.length === 1 ? "is" : "are"} random` : "") + ".";
  return `<p>${esc(L.brief)}</p><dl class="facts">
    <dt>CORRECT RESULT</dt><dd>${esc(correct)}</dd>
    <dt>CHECKS</dt><dd>You have ${plural(L.budget.ancillas, "check")}.</dd>
    <dt>TARGETS</dt><dd>${esc(targets)}</dd>
    <dt>NOISE</dt><dd>${esc(L.noise_note || L.noise_params.label)}</dd>
    ${L.t_count ? `<dt>T GATES</dt><dd>${L.t_count} T/T† gates.</dd>` : ""}</dl>`;
}

function infoBody(key) {
  if (key.startsWith("series:")) { const c = SERIES_COPY[key.slice(7)]; return [c ? c.title : "SERIES", `<p>${esc(c ? c.text : "")}</p>`]; }
  const p = S.percentiles || {};
  const land = S.landscape;
  const sym = "<p>▼ this run · ★ your best solved run · ◆ reference · the line is the target.</p>";
  switch (key) {
    case "fid": return ["FIDELITY", `<p>How close the kept runs are to the ideal result. Higher is better.</p><p>This is the Hellinger fidelity of the kept measurement distribution, not quantum-state fidelity.</p>${sym}<p>This run is higher than ${pct(p.fid, 0)} of evaluated layouts.</p>`];
    case "yld": return ["YIELD", `<p>The fraction of runs the checks kept. Higher is better.</p><p>A very high Fidelity is less useful if almost no runs survive.</p>${sym}<p>This run is higher than ${pct(p.yld, 0)} of evaluated layouts.</p>`];
    case "cost": return ["COST", `<p>Ancillas + extra two-qubit gates. Lower is better.</p><p>Extra depth is shown in the comparison table. No puzzle sets a cost target.</p><p>▼ this run · ★ your lowest among solved runs · ◆ reference.</p><p>This run is lower than ${pct(p.cost, 0)} of evaluated layouts.</p>`];
    case "scope": return ["FIDELITY VS YIELD", `<p>Each dot is a layout Checkpoint evaluated. Up means higher Fidelity; right means more runs kept.</p>
      <p>The bright line joins layouts that no other evaluated layout beats on both. Yellow is this run, faint rings are your past runs, the hollow ring is the circuit with no checks, and the orange diamond is the automated reference.</p>
      <p>The search is not exhaustive. "Best found" is the best in this search, not a proof of a global optimum.</p>
      ${land ? `<p>${land.meta.valid_layouts} valid layouts (single checks ${land.meta.single_checks_exhaustive ? "exhaustive" : "sampled"}, ${land.meta.multi_check_layouts_sampled} multi-check layouts from the best singles plus a seeded random sample, seed ${land.meta.seed}).</p>` : ""}
      <p>Checkpoint simulates the stated noise model with Qiskit Aer and calculates the resulting probabilities without finite-shot sampling noise. This makes the same layout reproducible under the same model. It does not make the noise model a perfect description of real hardware.</p>`];
    case "outputs": return ["OUTPUTS", `<p>Each row is one possible result of measuring the qubits. O marks a correct result, X a wrong one.</p>
      <p>NO CHECKS shows how often each result appears without any check. YOU KEPT shows the same among the runs your checks kept.</p>
      <p>A check cannot turn a wrong result into a right one. It discards runs it flags, so wrong results become rarer among the runs you keep.</p>`];
    case "table": {
      const r = S.result;
      const noRef = S.level.clifford === false
        ? "No automated reference is shown for this puzzle because qiskit-paulice accepts Clifford-only circuits. Compare your layout with the no-check baseline and the other layouts evaluated by Checkpoint instead."
        : (r.par && r.par.reason) || "";
      return ["COMPARISON", `<p>F = fidelity, Y = yield, ANC = ancillas, +2Q = extra two-qubit gates, +DEPTH = extra layers.</p><p>The reference is the automated layout from qiskit-paulice, with the same check budget.</p>${r.par && r.par.available ? "" : `<p>${esc(noRef)}</p>`}`];
    }
    default: return ["INFO", ""];
  }
}

const MODALS = {
  welcome: () => win("WELCOME TO CHECKPOINT", `
    <p>Quantum circuits are noisy: a gate can introduce an error, and that error can change the final result. One way to deal with this is to add a <b>check</b>. A check looks for certain errors while the circuit runs.</p>
    <p>A check cannot fix a bad run. If it flags a run, Checkpoint discards that run and keeps the others. This can make the results we keep more reliable, but it also leaves us with fewer results. Checks also need extra qubits and gates, which can introduce noise of their own.</p>
    <p>Your task is to place checks that strike a useful balance: <b>reliable results, enough runs kept, and reasonable overhead</b>. Each puzzle introduces one new idea. Try a layout, verify that it preserves the ideal computation, then run it under noise to see what changed.</p>
    <p><b>New here? Read the user manual first.</b> It explains every part of the game. It opens in a new tab from the <b>MANUAL</b> button below the screen, or from the button here.</p>
    <div class="metric-cards">
      <div><span class="k">FIDELITY</span><b>How close are the kept results to the ideal result?</b><span>Higher is better.</span></div>
      <div><span class="k">YIELD</span><b>What fraction of runs did we keep?</b><span>Higher means less data was discarded.</span></div>
      <div><span class="k">COST</span><b>How much extra hardware does this layout add in our game model?</b><span>Lower is better. Here, cost counts ancillas and extra two-qubit gates; extra depth is shown separately.</span></div>
    </div>`,
    `<button type="button" class="wbtn bevel manual" data-manual><span class="pled ${PREFS.manualOpened ? "" : "amber blink"}" aria-hidden="true"></span>READ THE MANUAL</button><button type="button" class="wbtn bevel" data-skip>NO TUTORIAL</button><button type="button" class="wbtn bevel go" data-tutorial data-autofocus>START THE TUTORIAL</button>`, false, "data-skip"),
  about: () => win("ABOUT THE PUZZLE", aboutBody(), okButton(), true),
  hint: () => win("HINT", `<p>${esc(S.level.hint || "")}</p>`, okButton(), true),
  howto: () => win("HOW TO PLAY", `<ol>
      <li>Drag a check from the rack onto a slot. That sets where it starts.</li>
      <li>Drag the handle to a later slot. That sets where it ends.</li>
      <li>The game works out the end edge for you.</li>
      <li>Press <b>VERIFY</b>. Then press <b>TEST UNDER NOISE</b>.</li>
    </ol>
    <p><b>How a check works.</b> A check watches one property across its span. The glowing wires show where. A Z there catches bit flips (X, Y); an X catches phase flips (Z, Y). If the property changes, the run is discarded. Each error badge shows how much of that gate's errors your checks would see.</p>
    <p>Drop a second piece in the same slot to start one check on two qubits. Some puzzles need this.</p>
    <p>You can also click a check type, then click two slots. Drag the end of a placed check to change its span.</p>
    <p>The <b>i</b> button shows what a correct result looks like. Stuck? The red <b>!</b> button shows a solution.</p>
    <p>Click a placed check to see its edges or remove it.</p>
    <p>The <b>MANUAL</b> button below the screen opens the full user manual.</p>
    <p>The <b>i</b> button shows the puzzle's goal. The <b>?</b> button shows a hint.</p>`, okButton(), true),
  glossary: () => win("GLOSSARY", `<div class="glossary">${GLOSSARY.map(([h, items]) => `<h3>${esc(h)}</h3><dl>${items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>`).join("")}</div>`, okButton("CLOSE")),
  info: () => { const [t, body] = infoBody(S.info || ""); return win(t, body, okButton(), true); },
  solutionConfirm: () => win("SEE THE SOLUTION?", `<p>Really see the solution? Try your own layout first.</p>
    <p>To see it, press and hold <b>HOLD YES</b> for ${HOLD_MS / 1000} seconds. Letting go early cancels.</p>`,
    `<button type="button" class="wbtn bevel go" data-close data-autofocus>NO, KEEP TRYING</button>
     <button type="button" class="wbtn bevel hold" data-hold aria-label="Hold to see the solution"><span class="fill" aria-hidden="true"></span><span class="lbl">HOLD YES</span></button>`, true),
  solution: () => {
    const L = S.level, sol = S.solution, r = sol.result, g = r.goal || {}, m = r.metrics || {};
    const mk = (ok) => `<span class="mark ${ok ? "ok" : "miss"}">${ok ? "O" : "X"}</span>`;
    return win(`SOLUTION · PUZZLE ${L.id}`, `<div class="solboard" aria-hidden="true">${solutionBoardSVG()}</div>
      <div class="solscore"><span>FIDELITY ${f3(m.fidelity)} ${mk(g.fidelity_ok)}</span><span>YIELD ${pct(m.yield)} ${mk(g.yield_ok)}</span><span>COST ${m.cost}</span></div>
      ${L.solution.explanation.map((t) => `<p>${esc(t)}</p>`).join("")}`,
      `<button type="button" class="wbtn bevel" data-close>CLOSE</button><button type="button" class="wbtn bevel go" data-loadsol data-autofocus>LOAD ONTO BOARD</button>`, "wide");
  },
  resultsPrompt: () => win("RESULTS TOUR", "<p>Want a quick tour of your results?</p>",
    `<button type="button" class="wbtn bevel" data-rtour="no">NO THANKS</button><button type="button" class="wbtn bevel go" data-rtour="yes" data-autofocus>YES</button>`, true, 'data-rtour="no"'),
};

function menuHTML() {
  const items = [];
  if (S.view === "puzzle") {
    items.push(["clear", "Remove all checks"]);
    items.push(["howto", TOURS[S.level.id] ? "Replay the tour" : "How to play"]);
  } else if (S.view === "results") {
    if (S.level.id === RESULTS_TOUR_LEVEL) items.push(["rtour", "Replay the results tour"]);
    items.push(["howto", "How to play"]);
  } else {
    items.push(["welcome", "How to play"]);
  }
  items.push(["glossary", "Glossary"]);
  items.push(["crt", `CRT effect: ${PREFS.crt === false ? "OFF" : "ON"}`]);
  if (S.view !== "select") items.push(["home", "Back to puzzle list"]);
  return `<div class="menu bevel" role="menu" data-anchor="[data-menu]">${items.map(([k, label]) => `<button type="button" role="menuitem" data-menuitem="${k}">${esc(label)}</button>`).join("")}</div>`;
}

function watchesText(c) {
  const types = new Set((c.trail || []).flatMap((t) => Object.values(t)));
  const parts = [];
  if (types.has("Z")) parts.push("Z catches X, Y (bit flips).");
  if (types.has("X")) parts.push("X catches Z, Y (phase flips).");
  if (types.has("Y")) parts.push("Y catches X, Z.");
  return parts.join(" ");
}

function checkPanelHTML(i) {
  const c = S.checks[i];
  if (!c) return "";
  const M = S.level.moments.length;
  const readout = c.can_merge
    ? `<label><input type="checkbox" data-merge="${i}" ${c.merged ? "checked" : ""}> Use final readout (no extra end-edge gates)</label>`
    : `<div class="muted">${c.right === M ? "No final readout: the end edge has X or Y." : "End edge uses extra gates."}</div>`;
  return `<div class="checkpanel bevel" role="dialog" aria-label="Check ${LETTERS[i]}" data-anchor='[data-checkopen="${i}"]'>
    <div class="ttl"><span>CHECK ${LETTERS[i]}</span><button type="button" class="x" data-panelclose aria-label="Close">✕</button></div>
    <div class="row"><b>Span:</b> slots ${c.left} → ${c.right}</div>
    <div class="row"><b>Start edge:</b> ${esc(edgeText(c.paulis))}</div>
    <div class="row"><b>End edge:</b> ${esc(edgeText(c.right_paulis))}</div>
    ${c.sign < 0 ? `<div class="row"><b>Sign:</b> −1 (a Z on the ancilla fixes it)</div>` : ""}
    <div class="row"><b>Watches</b> the glowing wires. ${esc(watchesText(c))}</div>
    ${readout}
    <button type="button" class="mini bevel" data-remove="${i}">REMOVE</button></div>`;
}

function printHTML(kind) {
  const L = S.level;
  let title = "", body = "";
  if (kind === "report") {
    const r = S.result, g = r.goal, m = r.metrics;
    title = `RUN REPORT · PUZZLE ${L.id}`;
    body = `<p><b>Fidelity</b> ${f3(m.fidelity)} (target ${f3(g.fidelity)}, ${g.fidelity_ok ? "met" : "missed"}) · <b>Yield</b> ${pct(m.yield)} (target ${pct(g.min_yield)}, ${g.yield_ok ? "met" : "missed"}) · <b>Cost</b> ${m.cost}</p>`
      + takeaway(r, S.landscape).map((p) => `<p>${esc(p)}</p>`).join("");
  } else if (kind === "lesson") {
    title = `LESSON · PUZZLE ${L.id}`;
    body = `<p>${esc(L.learning_moment)}</p>${L.reflection ? `<p><b>Think about it:</b> ${esc(L.reflection)}</p>` : ""}`;
  } else {
    const d = S.series, copy = SERIES_COPY[d.series] || { title: d.series, text: "" }, best = loadBest();
    title = `${copy.title} · COMPARISON`;
    body = `<p>${esc(copy.text)}</p><table><thead><tr><th>PUZZLE</th><th>T/T†</th><th>DEPTH</th><th>F, NO CHECKS</th><th>BEST F (Y ≥ ${pct(d.rows[0].yield_floor, 0)})</th><th>ITS Y</th><th>YOUR BEST</th></tr></thead><tbody>
      ${d.rows.map((x) => { const b = best[x.id]; return `<tr><td>${esc(x.id)}</td><td>${x.t_count}</td><td>${x.depth}</td><td>${f3(x.baseline_fidelity)}</td><td>${f3(x.best_fidelity)}</td><td>${pct(x.best_yield)}</td><td>${b ? `${f3(b.fidelity)} / ${pct(b.yield)}` : "--"}</td></tr>`; }).join("")}
      </tbody></table><p>Computed by Checkpoint from each puzzle's evaluated layouts under that puzzle's noise model. "Best found" is the best in this search, not a proof that no better layout exists. "Your best" is the best result this browser remembers for you.</p>`;
  }
  return `<div class="printer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="slot" aria-hidden="true"></div>
    <div class="paperwrap"><article class="paper"><h3>${esc(title)}</h3>${body}<div class="tear"><button type="button" class="wbtn bevel" data-printclose data-autofocus>TEAR OFF ✕</button></div></article></div></div>`;
}

function renderLayer() {
  let o = "";
  if (S.view === "puzzle" && S.openCheck != null && !S.modal) o += checkPanelHTML(S.openCheck);
  if (S.menu) o += menuHTML();
  if (S.print) o += printHTML(S.print);
  if (S.modal) o += MODALS[S.modal]();
  $layer.innerHTML = o;
  const f = $layer.querySelector("[data-autofocus]") || (S.menu && $layer.querySelector(".menu button"));
  if (f) f.focus({ preventScroll: true });
}

// Menus and check panels are drawn next to the element they belong to.
function positionAnchored() {
  const sr = $screen.getBoundingClientRect();
  for (const el of $layer.querySelectorAll("[data-anchor]")) {
    const a = document.querySelector(el.dataset.anchor);
    if (!a) continue;
    const r = a.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = r.right - sr.left - w, top = r.bottom - sr.top + 8;
    if (el.classList.contains("checkpanel")) {
      left = r.left - sr.left + 40;
      if (top + h > sr.height - 8) {
        const box = document.querySelector(".boardbox").getBoundingClientRect();
        const checkMid = r.left + r.width / 2;
        top = box.top - sr.top + 8;
        left = checkMid < box.left + box.width / 2 ? box.right - sr.left - w - 8 : box.left - sr.left + 8;
      }
    }
    if (el.classList.contains("menu") && r.left - sr.left < sr.width / 2) left = r.left - sr.left;
    el.style.left = Math.max(8, Math.min(left, sr.width - w - 8)) + "px";
    el.style.top = Math.max(8, Math.min(top, sr.height - h - 8)) + "px";
  }
}

function chooseTutorial(on) {
  setPref("welcomeSeen", true);
  setPref("tourDone", Object.fromEntries(Object.keys(TOURS).filter((k) => k !== "results").map((k) => [k, !on])));
  setPref("resultsTourOffered", !on);
}

const HOLD_MS = 5000; // how long YES must be held before the solution appears

// The board drawn with the solution's checks instead of the player's. The live state is swapped out
// and restored, and the copy is made inert (no ids or tour targets that clash with the real board).
function solutionBoardSVG() {
  const sol = S.solution, keep = { checks: S.checks, pending: S.pending, preview: S.preview, result: S.result, openCheck: S.openCheck, blocked: S.blocked };
  try {
    S.checks = S.level.solution.checks.map((c, i) => ({ ...c, merge: null, ...sol.preview.checks[i] }));
    Object.assign(S, { pending: null, preview: sol.preview, result: null, openCheck: null, blocked: null });
    return boardSVG().replace('id="board"', 'id="solboard"').replace(/ data-tour="[^"]*"/g, "").replace(/ id="handle"/g, "");
  } finally { Object.assign(S, keep); }
}

async function showSolution() {
  const checks = S.level.solution.checks;
  const [preview, result] = await Promise.all([
    API.post("/api/preview", { level_id: S.level.id, checks }),
    API.post("/api/evaluate", { level_id: S.level.id, checks }),
  ]);
  S.solution = { preview, result };
  S.modal = "solution";
  render();
}

async function loadSolution() {
  S.checks = S.level.solution.checks.map((c) => ({ left: c.left, right: c.right, paulis: { ...c.paulis }, merge: null }));
  Object.assign(S, { pending: null, openCheck: null, modal: null, print: null, view: "puzzle" });
  boardChanged();
  await refreshPreview();
  render();
  toast("info", "Solution loaded", ["Press VERIFY, then TEST UNDER NOISE", "to see it scored."]);
}

// Hold-to-confirm: the fill grows while YES is held, and the solution opens when it is full.
let hold = null;
function startHold(btn) {
  if (hold) return;
  const fill = btn.querySelector(".fill"), t0 = performance.now();
  hold = { raf: 0 };
  const tick = (t) => {
    if (!hold) return;
    const f = Math.min(1, (t - t0) / HOLD_MS);
    fill.style.width = `${f * 100}%`;
    if (f >= 1) { hold = null; showSolution().catch(engineError); return; }
    hold.raf = requestAnimationFrame(tick);
  };
  hold.raf = requestAnimationFrame(tick);
}
function cancelHold() {
  if (!hold) return;
  cancelAnimationFrame(hold.raf);
  hold = null;
  const fill = document.querySelector("[data-hold] .fill");
  if (fill) fill.style.width = "0";
}
document.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-hold]"); if (b && e.button === 0) { e.preventDefault(); startHold(b); } });
for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, cancelHold);
document.addEventListener("pointerout", (e) => { if (hold && e.target.closest && e.target.closest("[data-hold]") && !e.target.closest("[data-hold]").contains(e.relatedTarget)) cancelHold(); });
document.addEventListener("keydown", (e) => { const b = e.target.closest && e.target.closest("[data-hold]"); if (b && (e.key === " " || e.key === "Enter")) { e.preventDefault(); if (!e.repeat) startHold(b); } });
document.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") cancelHold(); });

function closeModal() {
  const was = S.modal;
  if (was === "welcome") chooseTutorial(false);
  if (was === "resultsPrompt") setPref("resultsTourOffered", true);
  S.modal = null;
  if (was === "about" && S.startTourAfterAbout) { S.startTourAfterAbout = false; S.tour = { name: S.level.id, i: 0 }; }
  render();
}

/* ------------------------------------------------------------------ guided tours */

const RESULTS_TOUR_LEVEL = "01"; // the opt-in results tour is offered on this puzzle's first results screen
const verified = () => S.result && S.result.valid && S.result.verify && S.result.verify.passed;
const slipped = () => ((S.result && S.result.outputs) || []).filter((o) => !o.correct && o.kept >= 0.5 * o.baseline && o.baseline > 0.002).map((o) => o.bits);

// Each step names the screen it belongs to; on another screen the tour waits silently.
const TOURS = {
  "00": [
    { view: "puzzle", target: '[data-tour="board"]', text: () => ["This circuit copies q0 onto q1.", "q0 starts at 0, so the correct result is always 00.", "The CNOT is noisy, so some runs come out wrong."] },
    { view: "puzzle", target: '[data-tour="readout"]', text: () => ["Each run ends here: both qubits are measured.", "The i button always shows what a correct result looks like."] },
    { view: "puzzle", target: "[data-run]", place: "above", text: () => ["First, test the circuit with no checks.", "Press TEST UNDER NOISE."], until: () => S.view === "results" },
    { view: "results", target: '[data-tour="outputs"]', text: () => ["These are the results.", "00 is correct. 01, 10 and 11 are wrong: noise made them."] },
    { view: "results", target: '[data-tour="fid"]', text: () => ["Fidelity: how much of what you kept is correct.", S.result && S.result.goal.fidelity_ok ? "It is green: the target is met." : "It is red: the target is not met yet."] },
    { view: "results", target: "[data-back]", place: "above", text: () => ["Now add a check.", "Press EDIT LAYOUT."], until: () => S.view === "puzzle" },
    { view: "puzzle", target: '[data-tool="Z"]', text: () => ["This is a Z check.", "It watches for errors. It cannot fix them."] },
    { view: "puzzle", target: '[data-tour="start"]', place: "above", text: () => ["Drag the Z check onto q1 here.", "This is where the check starts."], until: () => S.pending || S.checks.length },
    { view: "puzzle", target: '[data-tour="end"]', place: "above", text: () => [`Drag the handle to slot ${S.level.tutorial.end}.`, "That is where the check ends."], until: () => S.checks.length > 0, need: () => S.pending || S.checks.length, back: 7 },
    { view: "puzzle", target: '[data-checkopen="0"]', place: "above", text: () => howItWorks(), need: () => S.checks.length, back: 7 },
    { view: "puzzle", target: "[data-verify]", place: "above", text: () => ["Press VERIFY.", "It checks that your check breaks nothing when there is no noise."], until: verified, need: () => S.checks.length, back: 7 },
    { view: "puzzle", target: "[data-run]", place: "above", text: () => ["Now press TEST UNDER NOISE again."], until: () => S.view === "results" && S.result && S.result.metrics && S.result.metrics.ancillas > 0, need: () => S.checks.length || S.view === "results", back: 7 },
    { view: "results", target: '[data-tour="outputs"]', text: () => ["Most wrong results are gone: they were discarded.", ...(slipped().length ? [`${slipped().join(" and ")} slipped through: your check cannot see that error.`] : [])] },
    { view: "results", target: '[data-tour="yld"]', text: () => ["But fewer runs are kept: that is Yield.", "A check trades some Yield for Fidelity."] },
    { view: "results", target: "[data-solution]", text: () => ["Stuck on a puzzle, or solved it and curious?", "The red button shows a worked solution. Try your own layout first."] },
    { view: "results", target: "[data-next]", place: "above", text: () => ["Ready? On to the next puzzle."] },
  ],
  "01": [
    { view: "puzzle", target: '[data-modal="about"]', text: () => ["Now two results are correct: 00 and 11.", "q0 and q1 always agree. The i button lists the rules."] },
    { view: "puzzle", target: '[data-tour="start"]', place: "above", text: () => ["Drag a Z check onto q1 here."], until: () => S.pending || S.checks.length },
    { view: "puzzle", target: '[data-tour="end"]', place: "above", text: () => [`Drag the handle to slot ${S.level.tutorial.end}, after all three CNOTs.`], until: () => S.checks.length > 0, need: () => S.pending || S.checks.length, back: 1 },
    { view: "puzzle", target: '[data-tour="board"]', place: "above", text: () => howItWorks(), need: () => S.checks.length, back: 1 },
    { view: "puzzle", target: '[data-tour="badge"]', text: () => ["Each badge shows a gate's error rate,", "and how much of it your checks would see."], need: () => S.checks.length, back: 1 },
    { view: "puzzle", target: '[data-tool="Z"]', text: () => ["Tip: drop a second piece in the same slot", "to start one check on two qubits. Later puzzles need this."], need: () => S.checks.length, back: 1 },
    { view: "puzzle", target: "[data-verify]", place: "above", text: () => ["Press VERIFY, then TEST UNDER NOISE."], until: verified, need: () => S.checks.length, back: 1 },
    { view: "puzzle", target: "[data-run]", place: "above", text: () => ["Now press TEST UNDER NOISE."], until: () => S.view === "results", need: () => S.checks.length || S.view === "results", back: 1 },
  ],
  results: [
    { target: '[data-tour="fid"]', text: () => ["Fidelity: how close your kept runs are to the ideal result.", "Green with O means the target is met."] },
    { target: '[data-tour="line"]', text: () => ["The line is the target.", "Bars right of it pass."] },
    { target: '[data-tour="marks"]', text: () => ["▼ is this run.", "★ is your best solved run so far."] },
    { target: '[data-tour="yld"]', text: () => ["Yield: how many runs you kept.", "Checks discard some runs."] },
    { target: '[data-tour="cost"]', text: () => ["Cost: extra ancillas and gates.", "Lower is better."] },
    { target: '[data-tour="scope"]', text: () => ["Each dot is a layout the game tried.", "Up is better fidelity. Right keeps more runs."] },
    { target: '[data-tour="front"]', text: () => ["The bright line joins the best trade-offs.", "No dot beats them on both."] },
    { target: '[data-tour="table"]', text: () => ["Your layout, next to no checks and the reference."] },
    { target: '[data-print="report"]', place: "above", text: () => ["RUN REPORT prints what happened in this run."] },
    { target: '[data-print="lesson"]', place: "above", text: () => ["LESSON prints the idea behind this puzzle."] },
    { target: "[data-next]", place: "above", text: () => ["Ready? On to the next puzzle."] },
  ],
};

// The "how a check works" step, written for whatever check the player actually placed.
function howItWorks() {
  const c = S.checks[0];
  const end = c && c.right_paulis ? Object.entries(c.right_paulis) : [];
  const lines = ["The glow shows where the check watches.", "A Z there catches bit flips (X and Y). Errors outside the glow go unseen."];
  if (end.length === 2 && end.every(([, P]) => P === "Z")) lines.push(`At the end it asks: are q${end[0][0]} and q${end[1][0]} still equal? If not, the run is discarded.`);
  else if (end.length === 1 && end[0][1] === "Z") lines.push(`At the end it asks: is q${end[0][0]} still what it should be? If not, the run is discarded.`);
  return lines;
}

function endTour() {
  if (S.tour && S.tour.name !== "results") setPref("tourDone", { ...(PREFS.tourDone || {}), [S.tour.name]: true });
  S.tour = null;
  $tour.innerHTML = "";
}

// Keep the tour in step with what the player actually did: advance past finished actions, and go
// back when a needed check was removed.
function tourSync() {
  if (!S.tour) return;
  const steps = TOURS[S.tour.name];
  if (S.view === "select" || (S.tour.name === "results" && S.view !== "results") || (S.tour.name !== "results" && S.level && S.level.id !== S.tour.name)) { endTour(); return; }
  for (let guard = 0; guard < steps.length + 2; guard++) {
    const st = steps[S.tour.i];
    if (!st) break;
    if (st.need && !st.need()) { S.tour.i = st.back; continue; }
    if (st.until && st.until()) { S.tour.i++; continue; }
    break;
  }
  if (S.tour.i >= steps.length) endTour();
}

let lastTourKey = "";
function renderTour() {
  if (!S.tour || S.modal || S.print) { $tour.innerHTML = ""; lastTourKey = ""; return; }
  const steps = TOURS[S.tour.name], i = S.tour.i, st = steps[i];
  if (!st || (st.view && st.view !== S.view)) { $tour.innerHTML = ""; return; } // waiting for the player to reach that screen
  const el = document.querySelector(st.target);
  const last = i === steps.length - 1;
  const acts = st.until
    ? `<span class="do">Do this to continue.</span>`
    : `${i > 0 && !steps[i - 1].until ? `<button type="button" class="wbtn bevel" data-tour-back>BACK</button>` : ""}<button type="button" class="wbtn bevel go" data-tour-next>${last ? "FINISH" : "NEXT"}</button>`;
  const r = el ? el.getBoundingClientRect() : null, pad = 6;
  $tour.innerHTML = `${r ? `<div class="spot" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px"></div>` : ""}
    <div class="coach bevel" role="dialog" aria-label="Tour step ${i + 1} of ${steps.length}" style="left:0;top:0;visibility:hidden">
    <div class="count">${i + 1} / ${steps.length}</div><div class="text" aria-live="polite">${st.text().map((t) => `<p>${esc(t)}</p>`).join("")}</div>
    <div class="acts">${acts}<button type="button" class="skip" data-tour-skip>SKIP TOUR</button></div></div>`;
  const coach = $tour.querySelector(".coach");
  const vw = window.innerWidth, vh = window.innerHeight, CW = coach.offsetWidth, CH = coach.offsetHeight, gap = 16;
  let left = (vw - CW) / 2, top = (vh - CH) / 3;
  if (r) {
    const fits = { right: r.right + gap + CW < vw, left: r.left - gap - CW > 0, above: r.top - gap - CH > 0, below: r.bottom + gap + CH < vh };
    const order = st.place === "above" ? ["above", "right", "left", "below"] : ["right", "left", "below", "above"];
    const side = order.find((sd) => fits[sd]);
    if (side === "right") { left = r.right + gap; top = r.top; }
    else if (side === "left") { left = r.left - gap - CW; top = r.top; }
    else if (side === "above") { left = r.left + r.width / 2 - CW / 2; top = r.top - gap - CH; }
    else if (side === "below") { left = r.left + r.width / 2 - CW / 2; top = r.bottom + gap; }
    else { left = r.right - CW - 20; top = r.bottom - CH - 20; } // target fills the screen: sit inside its corner
  }
  coach.style.left = Math.max(10, Math.min(left, vw - CW - 10)) + "px";
  coach.style.top = Math.max(10, Math.min(top, vh - CH - 10)) + "px";
  coach.style.visibility = "";
  const key = `${S.tour.name}:${i}`;
  if (key !== lastTourKey) {
    lastTourKey = key;
    const f = $tour.querySelector("[data-tour-next]");
    if (f) f.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ drag and drop */

let drag = null;
function svgPoint(svg, x, y) {
  const p = svg.createSVGPoint(); p.x = x; p.y = y;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function dropTarget(x, y, tool) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest(tool === "erase" ? ".check-hit" : ".slot-hit");
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || S.view !== "puzzle" || S.busy || S.modal) return;
  const tool = e.target.closest("[data-tool]");
  const handle = e.target.closest("[data-handle]");
  const endHandle = e.target.closest("[data-endhandle]");
  if (tool) { drag = { kind: "tool", tool: tool.dataset.tool, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: null }; e.preventDefault(); }
  else if (endHandle) { drag = { kind: "end", i: Number(endHandle.dataset.endhandle), k: null, el: endHandle }; e.preventDefault(); }
  else if (handle && S.pending) { drag = { kind: "handle", k: null }; e.preventDefault(); }
});

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "tool") {
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
      drag.moved = true;
      const g = document.createElement("div");
      g.className = "ghost";
      g.style.color = drag.tool === "erase" ? "#5a4a36" : PAULI[drag.tool].ring;
      g.textContent = drag.tool === "erase" ? "✕" : drag.tool;
      document.body.appendChild(g);
      drag.ghost = g;
    }
    if (!drag.moved) return;
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
    const t = dropTarget(e.clientX, e.clientY, drag.tool);
    if (t !== drag.over) { if (drag.over) drag.over.classList.remove("drop"); if (t) t.classList.add("drop"); drag.over = t; }
  } else if (drag.kind === "end") {
    const svg = document.getElementById("board"), c = S.checks[drag.i];
    if (!svg || !c) return;
    const G = geom();
    const [, hi] = slotRange();
    drag.k = Math.max(c.left + 1, Math.min(hi, Math.round((svgPoint(svg, e.clientX, e.clientY).x - G.X0) / G.SLOT)));
    drag.el.setAttribute("transform", `translate(${G.xs(drag.k)},${G.ya(drag.i)})`);
  } else {
    const svg = document.getElementById("board");
    if (!svg || !S.pending) return;
    const G = geom();
    const [, hi] = slotRange();
    const k = Math.max(S.pending.left + 1, Math.min(hi, Math.round((svgPoint(svg, e.clientX, e.clientY).x - G.X0) / G.SLOT)));
    drag.k = k;
    const h = document.getElementById("handle"), line = document.getElementById("pend-pipe");
    if (h) h.setAttribute("transform", `translate(${G.xs(k)},${G.ya(S.checks.length)})`);
    if (line) line.setAttribute("x2", G.xs(k));
  }
});

document.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === "tool") {
    if (d.ghost) d.ghost.remove();
    if (d.over) d.over.classList.remove("drop");
    if (!d.moved) { S.tool = d.tool; render(); return; }
    const t = dropTarget(e.clientX, e.clientY, d.tool) || d.over;
    if (!t) return;
    if (d.tool === "erase") removeCheck(Number(t.dataset.checkopen)).catch(engineError);
    else { S.tool = d.tool; onSlot(Number(t.dataset.slot), Number(t.dataset.q), d.tool).catch(engineError); }
  } else if (d.kind === "end") {
    if (d.k != null && S.checks[d.i] && d.k !== S.checks[d.i].right) setEnd(d.i, d.k).catch(engineError);
  } else if (d.k != null && S.pending) {
    onSlot(d.k, Number(Object.keys(S.pending.paulis)[0]), S.tool).catch(engineError);
  }
});

/* ------------------------------------------------------------------ events */

function engineError(err) {
  S.busy = false;
  render();
  toast("error", "Something went wrong", ["Try again. If it keeps happening, reload the game."], String(err && err.message ? err.message : err));
}

function goHome() {
  endTour();
  Object.assign(S, { view: "select", menu: false, print: null, openCheck: null, pending: null });
  clearToasts();
  render();
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.matches("[data-backdrop]")) { if (S.modal === "welcome") { closeModal(); S.view = "select"; render(); } else closeModal(); return; }
  if (t.closest("[data-toast-close]")) { t.closest(".toast").remove(); return; }
  if (t.closest("[data-why]")) { const b = t.closest("[data-why]"), m = b.nextElementSibling; m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); return; }
  if (t.closest("[data-tour-next]")) { S.tour.i++; if (S.tour.i >= TOURS[S.tour.name].length) endTour(); else renderTour(); return; }
  if (t.closest("[data-tour-back]")) { S.tour.i = Math.max(0, S.tour.i - 1); renderTour(); return; }
  if (t.closest("[data-tour-skip]")) { endTour(); return; }
  if (S.menu && !t.closest(".menu") && !t.closest("[data-menu]")) { S.menu = false; render(); return; }
  if (S.openCheck != null && !t.closest(".checkpanel") && !t.closest("[data-checkopen]")) { S.openCheck = null; render(); }
  const el = t.closest("[data-level],[data-home],[data-tool],[data-slot],[data-checkopen],[data-remove],[data-verify],[data-run],[data-back],[data-modal],[data-close],[data-tutorial],[data-skip],[data-code],[data-menu],[data-menuitem],[data-info],[data-print],[data-printclose],[data-panelclose],[data-rtour],[data-solution],[data-loadsol],[data-manual]");
  if (!el || (S.busy && !el.matches("[data-close],[data-printclose]"))) return;
  try {
    if (el.dataset.solution !== undefined) { S.modal = "solutionConfirm"; S.menu = false; return render(); }
    if (el.dataset.loadsol !== undefined) return await loadSolution();
    if (el.dataset.manual !== undefined) return openManual();
    if (el.dataset.rtour !== undefined) { closeModal(); if (el.dataset.rtour === "yes") { S.tour = { name: "results", i: 0 }; render(); } return; }
    if (el.dataset.tutorial !== undefined) { chooseTutorial(true); S.modal = null; return await openLevel(S.levels[0].id); }
    if (el.dataset.skip !== undefined) { closeModal(); S.view = "select"; return render(); }
    if (el.dataset.close !== undefined) return closeModal();
    if (el.dataset.printclose !== undefined) { S.print = null; return render(); }
    if (el.dataset.panelclose !== undefined) { S.openCheck = null; return render(); }
    if (el.dataset.menu !== undefined) { S.menu = !S.menu; return render(); }
    if (el.dataset.menuitem !== undefined) return await onMenu(el.dataset.menuitem);
    if (el.dataset.modal !== undefined) { S.modal = el.dataset.modal; S.menu = false; return render(); }
    if (el.dataset.info !== undefined) { S.info = el.dataset.info; S.modal = "info"; return render(); }
    if (el.dataset.print !== undefined) { S.print = el.dataset.print; return render(); }
    if (el.dataset.code !== undefined) { S.codeOpen = !S.codeOpen; return render(); }
    if (el.dataset.level !== undefined) return await openLevel(el.dataset.level);
    if (el.dataset.home !== undefined) return goHome();
    if (el.dataset.back !== undefined) { Object.assign(S, { view: "puzzle", print: null }); if (S.result) S.result.verifyOnly = true; return render(); }
    if (el.dataset.tool !== undefined) { if (e.detail === 0) { S.tool = el.dataset.tool; render(); } return; } // pointer taps are handled by the drag code
    if (el.dataset.slot !== undefined) { if (S.tool !== "erase") await onSlot(Number(el.dataset.slot), Number(el.dataset.q), S.tool); return; }
    if (el.dataset.checkopen !== undefined) {
      const i = Number(el.dataset.checkopen);
      if (S.tool === "erase") return await removeCheck(i);
      S.openCheck = S.openCheck === i ? null : i;
      return render();
    }
    if (el.dataset.remove !== undefined) return await removeCheck(Number(el.dataset.remove));
    if (el.dataset.verify !== undefined) return await onVerify();
    if (el.dataset.run !== undefined) return await onRun();
  } catch (err) { engineError(err); }
});

async function onMenu(k) {
  S.menu = false;
  if (k === "clear") return clearBoard();
  if (k === "howto") { if (S.view === "puzzle" && TOURS[S.level.id]) { S.tour = { name: S.level.id, i: 0 }; return render(); } S.modal = "howto"; return render(); }
  if (k === "rtour") { S.tour = { name: "results", i: 0 }; return render(); }
  if (k === "welcome") { S.modal = "welcome"; return render(); }
  if (k === "glossary") { S.modal = "glossary"; return render(); }
  if (k === "crt") { setPref("crt", PREFS.crt === false); applyCrt(); return render(); }
  if (k === "home") return goHome();
}

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.merge === undefined) return;
  const i = Number(t.dataset.merge);
  S.checks[i].merge = t.checked;
  boardChanged();
  try { await refreshPreview(); } catch (err) { engineError(err); return; }
  render();
  toast("info", t.checked ? "Final readout on" : "Final readout off",
    t.checked ? ["The end edge is read from the measurements.", "No extra end-edge gates."] : ["The end edge uses gates.", "It cannot see readout errors."],
    t.checked
      ? "Final-readout mode enabled. The end-edge Zs are included in the measured parity, so no extra end-edge gates are needed. This can make some readout flips visible to the check, but even numbers of flips can cancel in the parity."
      : "Gate-based mode enabled. The check is completed with gates before the data is read out, so it cannot detect errors that happen only during the final measurement.");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (S.print) { S.print = null; render(); return; }
    if (S.modal) { if (S.modal === "welcome") { closeModal(); S.view = "select"; render(); } else closeModal(); return; }
    if (S.menu) { S.menu = false; render(); return; }
    if (S.openCheck != null) { S.openCheck = null; render(); return; }
    if (S.tour) { endTour(); return; }
    if (S.pending) { S.pending = null; render(); }
    return;
  }
  if (S.view !== "puzzle" || S.modal || S.print || e.target.tagName === "INPUT") return;
  const k = e.key.toUpperCase();
  if (["X", "Y", "Z"].includes(k) && S.level.parts.paulis.includes(k)) { S.tool = k; render(); }
  if (k === "E") { S.tool = "erase"; render(); }
});

// Title screen: the info line shows the lesson of whichever tile is hovered or focused.
document.addEventListener("mouseover", (e) => {
  if (S.view !== "select") return;
  const t = e.target.closest(".ptile");
  const line = document.getElementById("infoline");
  if (line) line.innerHTML = t ? infolineFor(t.dataset.level) : defaultInfoline();
});
document.addEventListener("focusin", (e) => {
  if (S.view !== "select" || !e.target.closest) return;
  const t = e.target.closest(".ptile");
  const line = document.getElementById("infoline");
  if (line && t) line.innerHTML = infolineFor(t.dataset.level);
});

window.addEventListener("resize", () => { positionAnchored(); renderTour(); });

(async function init() {
  applyCrt();
  try {
    S.levels = await API.get("/api/levels");
  } catch (err) {
    $view.innerHTML = `<div class="select"><div class="infoline">Could not reach the engine. Start it with python -m checkpoint.server and reload.</div></div>`;
    return;
  }
  if (!PREFS.welcomeSeen) S.modal = "welcome";
  render();
})();
