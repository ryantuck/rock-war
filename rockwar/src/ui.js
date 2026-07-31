// Frontend controller: watch games play out action-by-action with animated
// pieces, or run large batches in-browser. Same engine code as the CLI.
//
// How stepping works: the rules engine emits a structured event stream
// (state.events) with per-action sequence numbers and post-event snapshots
// (state.captureSnapshots). The UI advances the real game a full turn at a
// time, queues that turn's events, and each Step click replays ONE action's
// events with ghost-piece animations, rendering the matching snapshot after
// each event so the board is always exact.

import {
  newGame, defaultConfig, playTurn, playGame, applyPlacement, legalPlacements,
  armyStrengthOnBoard, fmtCell, obeliskStatus,
} from './game.js';
import { engineFactories, makeEngine } from './engines/index.js';
import { mulberry32 } from './rng.js';

const $ = (id) => document.getElementById(id);

// --- engine selectors -------------------------------------------------------

for (const sel of ['engineA', 'engineB', 'batchA', 'batchB']) {
  for (const name of Object.keys(engineFactories)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    $(sel).appendChild(opt);
  }
}
$('engineA').value = 'greedy';
$('engineB').value = 'random';
$('batchA').value = 'greedy';
$('batchB').value = 'random';

$('config').value = JSON.stringify(defaultConfig(), null, 2);

// --- live game state --------------------------------------------------------

let state = null;
let engines = null;
let rng = null;
let queue = [];          // events of the in-progress turn, grouped by seq
let animating = false;
let autoRunning = false;
let shownSeq = Infinity; // log entries with seq beyond this are hidden

function readConfig() {
  try {
    return { ...defaultConfig(), ...JSON.parse($('config').value) };
  } catch (e) {
    alert(`bad config JSON: ${e.message}`);
    return defaultConfig();
  }
}

function startGame() {
  stopAuto();
  queue = [];
  shownSeq = Infinity;
  const config = readConfig();
  rng = mulberry32(parseInt($('seed').value, 10) || 1);
  engines = { A: makeEngine($('engineA').value), B: makeEngine($('engineB').value) };
  state = newGame(config);
  state.captureSnapshots = true;
  render();
}

// Advance the real game by one placement or one full turn, and queue the
// events it produced for animated replay.
function fillQueue() {
  if (!state || state.phase === 'over') return;
  const before = state.events.length;
  if (state.phase === 'placement') {
    const army = state.placementQueue[0];
    let i = engines[army].placeScout(state, army, rng);
    if (typeof i !== 'number' || !state.cells[i] || state.cells[i].pieces.length !== 0) {
      i = legalPlacements(state)[0];
    }
    applyPlacement(state, army, i);
  } else {
    playTurn(state, engines, rng);
  }
  queue = state.events.slice(before);
}

// One Step = one action: replay every event sharing the next seq.
async function stepAction() {
  if (!state || animating) return;
  if (queue.length === 0) fillQueue();
  if (queue.length === 0) { render(); return; }
  animating = true;
  const seq = queue[0].seq;
  while (queue.length && queue[0].seq === seq) {
    const ev = queue.shift();
    // Reveal this action's log lines as its animation STARTS — the board
    // itself only re-renders after the flight (ghosts source from the
    // pre-event board), but the narration shouldn't trail the motion.
    shownSeq = ev.seq;
    renderLog();
    try { await animateEvent(ev); } catch (e) { console.error('animation error', e); }
    render(ev.after);
  }
  if (queue.length === 0) { shownSeq = Infinity; render(); }
  animating = false;
}

function stopAuto() {
  autoRunning = false;
  $('auto').textContent = '▶ Auto';
}

$('newGame').onclick = startGame;
$('step').onclick = () => { stopAuto(); stepAction(); };
$('auto').onclick = async () => {
  if (autoRunning) { stopAuto(); return; }
  if (!state || (state.phase === 'over' && queue.length === 0)) startGame();
  autoRunning = true;
  $('auto').textContent = '⏸ Pause';
  while (autoRunning && state && (state.phase !== 'over' || queue.length > 0)) {
    await stepAction();
    await new Promise((r) => setTimeout(r, 60));
  }
  stopAuto();
};

// --- animation --------------------------------------------------------------

const SPEEDS = { slow: 650, normal: 340, fast: 130 };
const dur = () => SPEEDS[$('speed').value] ?? 340;

function pageRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
}

function cellRect(i) {
  const el = document.querySelector(`#board .cell[data-i="${i}"]`);
  return el ? pageRect(el) : null;
}

function sideRect(army) {
  return pageRect($(`side${army}`));
}

// Hide the matching rendered piece so its ghost isn't doubled during flight.
function hideSourcePiece(cellIdx, army, value) {
  const cell = document.querySelector(`#board .cell[data-i="${cellIdx}"]`);
  if (!cell) return;
  for (const p of cell.querySelectorAll('.piece')) {
    if (p.textContent === String(value) && p.classList.contains(army)) {
      p.style.visibility = 'hidden';
      return;
    }
  }
}

function makeGhost(army, value, rect) {
  const g = pieceEl(army, value);
  g.classList.add('ghost');
  document.body.appendChild(g);
  const size = g.getBoundingClientRect();
  g.style.left = `${rect.x + rect.w / 2 - size.width / 2}px`;
  g.style.top = `${rect.y + rect.h / 2 - size.height / 2}px`;
  return g;
}

// Fly a ghost piece between two page rects.
function fly(army, value, from, to, { fadeOut = false, hide = null } = {}) {
  return new Promise((resolve) => {
    if (!from || !to) return resolve();
    if (hide !== null) hideSourcePiece(hide, army, value);
    const g = makeGhost(army, value, from);
    const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
    const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
    g.style.transition = `transform ${dur()}ms ease, opacity ${dur()}ms ease`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      g.style.transform = `translate(${dx}px, ${dy}px)`;
      if (fadeOut) g.style.opacity = '0.15';
    }));
    setTimeout(() => { g.remove(); resolve(); }, dur() + 50);
  });
}

// Fade a piece out in place (destruction, sacrifice, devolution).
function fade(army, value, cellIdx) {
  return new Promise((resolve) => {
    const rect = cellRect(cellIdx);
    if (!rect) return resolve();
    hideSourcePiece(cellIdx, army, value);
    const g = makeGhost(army, value, rect);
    g.style.transition = `transform ${dur()}ms ease, opacity ${dur()}ms ease`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      g.style.opacity = '0';
      g.style.transform = 'scale(1.7)';
    }));
    setTimeout(() => { g.remove(); resolve(); }, dur() + 50);
  });
}

function flash(cellIdx, cls = 'hitflash') {
  const el = document.querySelector(`#board .cell[data-i="${cellIdx}"]`);
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 450);
}

async function animateEvent(ev) {
  switch (ev.type) {
    case 'place':
    case 'spawn':
      return fly(ev.army, 1, sideRect(ev.army), cellRect(ev.to));
    case 'move':
    case 'retreat':
      return fly(ev.army, ev.piece, cellRect(ev.from), cellRect(ev.to), { hide: ev.from });
    case 'toSideboard':
      return fly(ev.army, ev.piece, cellRect(ev.from), sideRect(ev.army), { hide: ev.from, fadeOut: true });
    case 'evolve': {
      flash(ev.at, 'evolveflash');
      await Promise.all(ev.parts.map((p) => fade(ev.army, p, ev.at)));
      return;
    }
    case 'destroyed': {
      flash(ev.at);
      await Promise.all(ev.pieces.map((p) => fade(ev.army, p, ev.at)));
      return;
    }
    case 'sacrifice':
      return fade(ev.army, ev.piece, ev.at);
    case 'devolved': {
      flash(ev.at);
      return fade(ev.army, ev.piece, ev.at);
    }
    case 'attackDevolve': {
      flash(ev.to);
      return fly(ev.army, ev.piece, cellRect(ev.from), cellRect(ev.to), { hide: ev.from });
    }
    default:
      return;
  }
}

// --- rendering --------------------------------------------------------------

function pieceEl(army, value) {
  const el = document.createElement('div');
  el.className = `piece ${army} p${Math.min(value, 8)}`;
  el.textContent = value;
  return el;
}

// Render the board from a snapshot (mid-replay) or the live state.
function render(after = null) {
  if (!state) return;
  const { config } = state;
  const cells = after ? after.cells : state.cells;
  const sideboard = after ? after.sideboard : state.sideboard;
  const view = { ...state, cells, sideboard };

  const board = $('board');
  // Scale cells to the viewport (mobile) up to the 84px default; pieces,
  // ghosts, and obelisk positions all follow via the --cell variable. The
  // board's left offset measures the page chrome (body + panel padding),
  // which is symmetric — the panel itself shrinks to fit, so it can't be
  // the measurement source.
  const chrome = board.getBoundingClientRect().left;
  const avail = document.documentElement.clientWidth - 2 * Math.max(0, chrome);
  const cellPx = Math.max(40, Math.min(84, Math.floor((avail - (config.width - 1) * 6) / config.width)));
  document.documentElement.style.setProperty('--cell', `${cellPx}px`);
  board.style.gridTemplateColumns = `repeat(${config.width}, ${cellPx}px)`;
  board.innerHTML = '';
  cells.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (c.army ? ` army-${c.army}` : '');
    cell.dataset.i = i;
    const coord = document.createElement('span');
    coord.className = 'coord';
    coord.textContent = fmtCell(config, i);
    cell.appendChild(coord);
    for (const p of c.pieces) cell.appendChild(pieceEl(c.army, p));
    board.appendChild(cell);
  });

  // Obelisks sit on the corner points between cells (cell size + 6px gap).
  const pitch = cellPx + 6;
  for (const ob of config.obelisks ?? []) {
    const st = obeliskStatus(view, ob);
    const el = document.createElement('div');
    el.className = `obelisk ${ob.element}` + (st.controller ? ` ctrl-${st.controller}` : '');
    el.style.left = `${ob.corner[0] * pitch - 3 - 12}px`;
    el.style.top = `${ob.corner[1] * pitch - 3 - 12}px`;
    el.title = `${ob.element} → ${st.action}` +
      (st.controller ? `: ${st.controller} +${st.bonus}` : ' (uncontrolled)') +
      ` | adjacent value A ${st.score.A} · B ${st.score.B}`;
    if (st.controller) {
      const label = document.createElement('span');
      label.textContent = `+${st.bonus}`;
      el.appendChild(label);
    }
    board.appendChild(el);
  }

  for (const army of ['A', 'B']) {
    const row = $(`side${army}`);
    row.innerHTML = '';
    const sb = sideboard[army];
    for (const v of Object.keys(sb).map(Number).sort((a, b) => a - b)) {
      const n = sb[v];
      if (n <= 0) continue;
      // One compact stack per piece type: up to two peeking duplicates
      // underneath and a ×N count beside it.
      const stack = document.createElement('div');
      stack.className = 'sidestack';
      const wrap = document.createElement('div');
      wrap.className = 'stackwrap';
      const layers = Math.min(n, 3);
      for (let k = layers - 1; k >= 1; k--) {
        const p = pieceEl(army, v);
        p.classList.add('peek');
        p.style.transform = `translate(${k * 3}px, ${k * 3}px)`;
        wrap.appendChild(p);
      }
      const top = pieceEl(army, v);
      top.classList.add('stacktop');
      wrap.appendChild(top);
      stack.appendChild(wrap);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `×${n}`;
      stack.appendChild(count);
      row.appendChild(stack);
    }
  }

  const status = $('status');
  const replaying = queue.length > 0 || after !== null;
  if (state.phase === 'placement') {
    const army = state.placementQueue[0];
    status.innerHTML =
      `Placement — <span class="winner ${army}">Army ${army}</span> places a scout` +
      `<br>${state.placementQueue.length} placement${state.placementQueue.length === 1 ? '' : 's'} remaining`;
  } else if (state.phase === 'over' && !replaying) {
    if (state.winner === 'draw') {
      status.innerHTML = `Turn ${state.turn} — <span class="winner">draw</span> (${state.reason})`;
    } else {
      status.innerHTML = `Turn ${state.turn} — <span class="winner ${state.winner}">Army ${state.winner} wins</span> (${state.reason})`;
    }
  } else {
    const obSummary = ['A', 'B'].map((army) => {
      const held = (config.obelisks ?? [])
        .map((ob) => obeliskStatus(view, ob))
        .filter((st) => st.controller === army)
        .map((st) => `${st.element}+${st.bonus}`);
      return held.length ? `${army}: ${held.join(' ')}` : null;
    }).filter(Boolean).join(' · ');
    const strengths = `A ${armyStrengthOnBoard(view, 'A')} · B ${armyStrengthOnBoard(view, 'B')}`;
    status.innerHTML =
      `Turn ${state.turn} — <span class="winner ${state.toMove}">Army ${state.toMove}</span> to move` +
      (replaying ? ' <span class="replaying">· playing out turn…</span>' : '') +
      `<br>strength on board: ${strengths}` +
      (obSummary ? `<br>obelisks — ${obSummary}` : '');
  }

  renderLog();
}

function renderLog() {
  if (!state) return;
  const log = $('log');
  log.innerHTML = '';
  const entries = state.log.filter((e) => (e.seq ?? 0) <= shownSeq).slice(-120);
  entries.forEach((e, k) => {
    const div = document.createElement('div');
    div.className = 'entry' + (k >= entries.length - 8 ? ' recent' : '');
    div.innerHTML = `<span class="turn">t${e.turn}</span>${e.text}`;
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
}

// --- batch simulation -------------------------------------------------------

$('runBatch').onclick = async () => {
  const n = parseInt($('batchN').value, 10) || 100;
  const seed = parseInt($('batchSeed').value, 10) || 42;
  const nameA = $('batchA').value;
  const nameB = $('batchB').value;
  const config = readConfig();
  const e1 = makeEngine(nameA);
  const e2 = makeEngine(nameB);
  const n1 = nameA === nameB ? `${nameA}#1` : nameA;
  const n2 = nameA === nameB ? `${nameB}#2` : nameB;

  const wins = { [n1]: 0, [n2]: 0, draw: 0 };
  const seatWins = { A: 0, B: 0 };
  const reasons = {};
  let turnSum = 0;

  $('runBatch').disabled = true;
  const t0 = performance.now();
  for (let g = 0; g < n; g++) {
    const swapped = g % 2 === 1;
    const gameEngines = swapped ? { A: e2, B: e1 } : { A: e1, B: e2 };
    const names = swapped ? { A: n2, B: n1 } : { A: n1, B: n2 };
    const final = playGame({
      engines: gameEngines,
      config: structuredClone(config),
      rng: mulberry32(seed + g * 7919),
    });
    turnSum += final.turn;
    reasons[final.reason] = (reasons[final.reason] || 0) + 1;
    if (final.winner === 'draw') wins.draw++;
    else { wins[names[final.winner]]++; seatWins[final.winner]++; }
    if (g % 50 === 49) {
      $('batchProgress').textContent = `${g + 1}/${n}…`;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(2);
  $('batchProgress').textContent = '';
  $('runBatch').disabled = false;

  const pct = (x) => ((100 * x) / n).toFixed(1) + '%';
  $('batchOut').textContent = [
    `${n} games: ${n1} vs ${n2}  (seed ${seed}, seats swapped each game, ${secs}s)`,
    `  ${n1.padEnd(12)} ${String(wins[n1]).padStart(5)}  ${pct(wins[n1])}`,
    `  ${n2.padEnd(12)} ${String(wins[n2]).padStart(5)}  ${pct(wins[n2])}`,
    `  ${'draws'.padEnd(12)} ${String(wins.draw).padStart(5)}  ${pct(wins.draw)}`,
    `  seat A wins ${seatWins.A}, seat B wins ${seatWins.B} (first-mover check)`,
    `  avg game length: ${(turnSum / n).toFixed(1)} turns`,
    `  endings: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ].join('\n');
};

// Re-fit the board when the viewport changes (debounced).
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!animating) render(); }, 150);
});

startGame();
