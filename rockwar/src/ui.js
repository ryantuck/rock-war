// Frontend controller: watch games play out action-by-action with animated
// pieces, play interactively against an engine, or run large batches
// in-browser. Same engine code as the CLI.
//
// How stepping works: the rules engine emits a structured event stream
// (state.events) with per-action sequence numbers and post-event snapshots
// (state.captureSnapshots). The UI advances the real game a full turn at a
// time, queues that turn's events, and each Step click replays ONE action's
// events with ghost-piece animations, rendering the matching snapshot after
// each event so the board is always exact.
//
// Interactive play: pick "human" for either army. The advance() driver runs
// engine placements/turns automatically (with the same animated replay) and
// pauses whenever it's the human's move. A human turn keeps the exact slots
// ledger playTurn uses — per-contingent budget, action cap, obelisk bonus
// pools, first-turn handicap — and executes clicked actions through the same
// applyAction/offerReactions path, so the rules are identical to sim games.
// v1 limits for the human side: retreats are auto-planned (greedy's policy),
// no reaction-window casts on the opponent's turn, and no coordinated
// attacks or two-territory fire splits.

import {
  newGame, defaultConfig, playTurn, playGame, applyPlacement, legalPlacements,
  armyStrengthOnBoard, fmtCell, obeliskStatus, legalActions, applyAction,
  contingents, obeliskBonuses, offerReactions, finishTurn, checkGameEnd, other,
} from './game.js';
import { engineFactories, makeEngine } from './engines/index.js';
import { mulberry32 } from './rng.js';

const $ = (id) => document.getElementById(id);

// --- engine selectors -------------------------------------------------------

// Game selectors get a "human" entry (interactive play); batch runs stay
// engine-only.
for (const sel of ['engineA', 'engineB', 'batchA', 'batchB']) {
  const names = sel.startsWith('engine')
    ? ['human', ...Object.keys(engineFactories)]
    : Object.keys(engineFactories);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name === 'human' ? '☺ human (you)' : name;
    $(sel).appendChild(opt);
  }
}
$('engineA').value = 'greedy';
$('engineB').value = 'random';
$('batchA').value = 'greedy';
$('batchB').value = 'random';

$('config').value = JSON.stringify(defaultConfig(), null, 2);

// A "human" engine slot: moves come from board clicks, not from the engine
// interface. Retreats (and nothing else) are auto-planned with greedy's
// policy — stand on repels and exact ties, otherwise flee what can flee.
function makeHumanEngine() {
  const helper = makeEngine('greedy');
  return {
    name: 'human',
    human: true,
    placeScout: () => null,   // placements come from board clicks
    chooseAction: () => null, // actions come from board clicks
    planRetreats: (s, a, o, r) => helper.planRetreats(s, a, o, r),
    // no chooseReaction: the human side doesn't cast on the enemy's turn (v1)
  };
}

const mkEngine = (name) => (name === 'human' ? makeHumanEngine() : makeEngine(name));

// --- live game state --------------------------------------------------------

let state = null;
let engines = null;
let rng = null;
let queue = [];          // events of the in-progress turn, grouped by seq
let animating = false;
let autoRunning = false;
let shownSeq = Infinity; // log entries with seq beyond this are hidden

// interactive play
let interactive = false;
let uiMode = null;       // 'place' | 'turn' | null
let human = null;        // { army, slots, bonusPool, maxActions, limit }
let selCell = null;      // selected own territory
let selSlot = null;      // its slot in the ledger
let selActs = [];        // legal actions originating from selCell
let selPiece = null;     // which piece value moves/attacks (multi-piece cells)
let pending = null;      // ability target-picking: { element, fuel, acts, stage, mine }
let highlights = new Map(); // cell index -> highlight class

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
  uiMode = null;
  human = null;
  clearSelection();
  const config = readConfig();
  rng = mulberry32(parseInt($('seed').value, 10) || 1);
  engines = { A: mkEngine($('engineA').value), B: mkEngine($('engineB').value) };
  interactive = !!(engines.A.human || engines.B.human);
  $('step').style.display = interactive ? 'none' : '';
  $('auto').style.display = interactive ? 'none' : '';
  state = newGame(config);
  state.captureSnapshots = true;
  render();
  if (interactive) advance();
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

// Replay every queued event sharing the next seq — one action's worth.
async function replayOneGroup() {
  if (queue.length === 0) return;
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

async function drainQueue() {
  while (queue.length) await replayOneGroup();
}

// One Step = one action (engine-vs-engine spectator mode).
async function stepAction() {
  if (!state || animating) return;
  if (queue.length === 0) fillQueue();
  if (queue.length === 0) { render(); return; }
  await replayOneGroup();
}

function stopAuto() {
  autoRunning = false;
  $('auto').textContent = '▶ Auto';
}

$('newGame').onclick = startGame;
$('step').onclick = () => { if (interactive) return; stopAuto(); stepAction(); };
$('auto').onclick = async () => {
  if (interactive) return;
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

// --- interactive play -------------------------------------------------------

// Drive the game forward until it's the human's move (or the game ends).
// Engine placements and turns replay with the usual animations.
async function advance() {
  while (interactive && state) {
    if (state.phase === 'placement') {
      const army = state.placementQueue[0];
      if (engines[army].human) {
        uiMode = 'place';
        highlights = new Map();
        for (const i of legalPlacements(state)) highlights.set(i, 'hl-place');
        render();
        return;
      }
      fillQueue();
      await drainQueue();
    } else if (state.phase === 'play') {
      if (engines[state.toMove].human) { beginHumanTurn(); return; }
      fillQueue();
      await drainQueue();
    } else {
      await drainQueue();
      render();
      return;
    }
  }
}

async function humanPlace(i) {
  uiMode = null;
  highlights = new Map();
  const army = state.placementQueue[0];
  const before = state.events.length;
  applyPlacement(state, army, i);
  queue = state.events.slice(before);
  await drainQueue();
  advance();
}

// Start a human turn with the same ledger playTurn builds: one slot per
// contingent (snapshotted now), fib budget = strength, obelisk bonus pools,
// and the turn-1 handicap on both contingent count and action cap.
function beginHumanTurn() {
  const army = state.toMove;
  if (checkGameEnd(state)) { render(); advance(); return; }
  const { config } = state;
  const conts = contingents(state, army);
  state.abilitiesUsedThisTurn = [];
  const bonusPool = obeliskBonuses(state, army);
  const maxActions = state.turn === 1
    ? Math.min(config.maxActionsPerContingent, config.firstTurnActions ?? Infinity)
    : config.maxActionsPerContingent;
  const limit = state.turn === 1 ? (config.firstTurnContingents ?? Infinity) : Infinity;
  human = {
    army,
    slots: conts.map((c) => ({ cont: c, remaining: c.strength, taken: 0 })),
    bonusPool,
    maxActions,
    limit,
  };
  clearSelection();
  // Loss by immobilization: no contingent has any legal action.
  if (!anyHumanActions()) {
    state.phase = 'over';
    state.winner = other(army);
    state.reason = 'immobilized';
    state.log.push({ turn: state.turn, text: `${other(army)} wins: ${army} cannot act`, seq: state.eventSeq ?? 0 });
    human = null;
    render();
    return;
  }
  uiMode = 'turn';
  render();
}

// First-turn handicap: only `limit` contingents may act; a slot that hasn't
// acted is usable only while the acted count is below the limit.
function slotUsable(slot) {
  if (slot.taken > 0) return true;
  const acted = human.slots.filter((s) => s.taken > 0).length;
  return acted < human.limit;
}

function actsForSlot(slot) {
  if (!slotUsable(slot)) return [];
  return legalActions(state, slot.cont, slot.remaining, slot.taken,
    human.bonusPool, human.maxActions, null)
    .filter((a) => a.type !== 'coordAttack'); // not offered interactively (v1)
}

function anyHumanActions() {
  return human.slots.some((s) => actsForSlot(s).length > 0);
}

function clearSelection() {
  selCell = null;
  selSlot = null;
  selActs = [];
  selPiece = null;
  pending = null;
  highlights = new Map();
}

function deselect() { clearSelection(); render(); }

function selectCell(i) {
  const slot = human.slots.find((s) => s.cont.terrs.has(i) && state.cells[i].army === human.army);
  if (!slot) return deselect();
  const acts = actsForSlot(slot).filter((a) =>
    (a.type === 'spawn' && a.to === i) ||
    (a.type === 'move' && a.from === i) ||
    (a.type === 'attack' && a.from === i) ||
    (a.type === 'evolve' && a.at === i) ||
    (a.type === 'ability' && a.from === i));
  selCell = i;
  selSlot = slot;
  selActs = acts;
  selPiece = Math.max(...state.cells[i].pieces);
  pending = null;
  refreshMoveHighlights();
}

function refreshMoveHighlights() {
  highlights = new Map();
  for (const a of selActs) {
    if (a.type === 'move' && a.piece === selPiece) highlights.set(a.to, 'hl-move');
    else if (a.type === 'attack' && a.piece === selPiece) highlights.set(a.to, 'hl-attack');
  }
  render();
}

function onCellClick(i) {
  if (!interactive || animating || !state) return;
  if (uiMode === 'place') {
    if (highlights.get(i) === 'hl-place') humanPlace(i);
    return;
  }
  if (uiMode !== 'turn' || !human) return;
  if (pending) return onTargetClick(i);
  const cls = highlights.get(i);
  if (cls === 'hl-move' || cls === 'hl-attack') {
    const type = cls === 'hl-move' ? 'move' : 'attack';
    const act = selActs.find((a) => a.type === type && a.to === i && a.piece === selPiece);
    if (act) return execHuman(act);
  }
  if (state.cells[i].army === human.army) selectCell(i);
  else deselect();
}

// Ability casting: pick the target(s) on the board. Fire offers full
// single-territory hits, water/earth pick the strongest eligible piece in
// the clicked territory, air is a two-stage pick (yours, then theirs).
function startAbility(element, fuel) {
  let acts = selActs.filter((a) => a.type === 'ability' && a.element === element && a.fuel === fuel);
  if (element === 'fire') {
    acts = acts.filter((a) => a.hits.length === 1); // no split hits in the UI (v1)
    pending = { element, fuel, acts, stage: 'target' };
    setTargetHighlights(acts.map((a) => a.hits[0].target));
  } else if (element === 'air') {
    pending = { element, fuel, acts, stage: 'mine' };
    setTargetHighlights([...new Set(acts.map((a) => a.mine))]);
  } else {
    pending = { element, fuel, acts, stage: 'target' };
    setTargetHighlights([...new Set(acts.map((a) => a.target))]);
  }
  render();
}

function setTargetHighlights(cells) {
  highlights = new Map();
  for (const c of cells) highlights.set(c, 'hl-target');
}

function onTargetClick(i) {
  const p = pending;
  if (!highlights.has(i)) return deselect(); // click-off cancels the cast
  if (p.element === 'air') {
    if (p.stage === 'mine') {
      p.mine = i;
      p.stage = 'theirs';
      setTargetHighlights([...new Set(p.acts.filter((a) => a.mine === i).map((a) => a.theirs))]);
      render();
      return;
    }
    const act = p.acts.find((a) => a.mine === p.mine && a.theirs === i);
    if (act) return execHuman(act);
    return deselect();
  }
  if (p.element === 'fire') {
    const act = p.acts.find((a) => a.hits[0].target === i);
    if (act) return execHuman(act);
    return deselect();
  }
  const cands = p.acts.filter((a) => a.target === i).sort((a, b) => b.piece - a.piece);
  if (cands.length) return execHuman(cands[0]);
  return deselect();
}

// Execute one human action exactly the way playTurn would: bump the event
// seq, apply, grow the contingent on captures, pay from budget with obelisk
// pool top-ups, run the game-end check and the enemy's reaction window,
// then animate whatever happened. Stale clicks (mid-animation, or a button
// outliving the selection it was built for) re-verify against the current
// legal list and no-op instead of corrupting the ledger.
async function execHuman(act) {
  const slot = selSlot;
  if (!human || animating || !slot) return;
  if (!actsForSlot(slot).some((a) => JSON.stringify(a) === JSON.stringify(act))) {
    return deselect();
  }
  const army = human.army;
  clearSelection();
  const beyondCap = slot.taken >= human.maxActions;
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  const before = state.events.length;
  const res = applyAction(state, army, act, engines, rng);
  if (res.capturedTerritory !== undefined) slot.cont.terrs.add(res.capturedTerritory);
  if (res.captured) for (const c of res.captured) slot.cont.terrs.add(c);
  const drawn = beyondCap ? act.cost : Math.max(0, act.cost - slot.remaining);
  if (drawn > 0) {
    human.bonusPool[act.type] = (human.bonusPool[act.type] || 0) - drawn;
    state.log.push({
      turn: state.turn,
      text: `${army} draws ${drawn} obelisk ${act.type} budget${beyondCap ? ' (extra action)' : ''}`,
      seq: state.eventSeq,
    });
  }
  slot.remaining -= act.cost - drawn;
  slot.taken++;
  if (!checkGameEnd(state)) {
    // The other army may respond with obelisk abilities.
    offerReactions(state, other(army), engines, rng);
  }
  queue = state.events.slice(before);
  await drainQueue();
  if (state.phase !== 'play') {
    human = null;
    uiMode = null;
    render();
    advance();
    return;
  }
  if (!anyHumanActions()) return endHumanTurn();
  render();
}

function endHumanTurn() {
  if (!human || animating) return;
  clearSelection();
  human = null;
  uiMode = null;
  finishTurn(state);
  render();
  advance();
}

$('board').addEventListener('click', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl || cellEl.dataset.i === undefined) return;
  onCellClick(parseInt(cellEl.dataset.i, 10));
});

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

  // Interactive highlights — only on the live board, never mid-replay.
  if (interactive && !after) {
    for (const [i, cls] of highlights) {
      const el = board.querySelector(`.cell[data-i="${i}"]`);
      if (el) el.classList.add(cls, 'clickable');
    }
    if (selCell !== null) {
      board.querySelector(`.cell[data-i="${selCell}"]`)?.classList.add('sel');
    }
    if (uiMode === 'turn' && human && !pending) {
      cells.forEach((c, i) => {
        if (c.army === human.army) {
          board.querySelector(`.cell[data-i="${i}"]`)?.classList.add('clickable');
        }
      });
    }
  }

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
    const who = interactive && engines[army].human ? 'You place' : `Army ${army} places`;
    status.innerHTML =
      `Placement — <span class="winner ${army}">${who}</span> a scout` +
      `<br>${state.placementQueue.length} placement${state.placementQueue.length === 1 ? '' : 's'} remaining`;
  } else if (state.phase === 'over' && !replaying) {
    if (state.winner === 'draw') {
      status.innerHTML = `Turn ${state.turn} — <span class="winner">draw</span> (${state.reason})`;
    } else {
      const label = interactive && engines[state.winner]?.human
        ? 'You win!' : `Army ${state.winner} wins`;
      status.innerHTML = `Turn ${state.turn} — <span class="winner ${state.winner}">${label}</span> (${state.reason})`;
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
    const mover = interactive && engines[state.toMove]?.human ? 'You' : `Army ${state.toMove}`;
    status.innerHTML =
      `Turn ${state.turn} — <span class="winner ${state.toMove}">${mover}</span> to move` +
      (replaying ? ' <span class="replaying">· playing out turn…</span>' : '') +
      `<br>strength on board: ${strengths}` +
      (obSummary ? `<br>obelisks — ${obSummary}` : '');
  }

  renderActionBar();
  renderLog();
}

function addBtn(parent, label, onclick, cls = null) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.classList.add(cls);
  b.onclick = onclick;
  parent.appendChild(b);
  return b;
}

// The interactive prompt panel under the board: what to do next, each
// contingent's remaining budget/actions, and buttons for the non-click
// actions (spawn, evolve, abilities, piece choice, end turn).
function renderActionBar() {
  const bar = $('actionBar');
  if (!bar) return;
  if (!interactive || (uiMode !== 'turn' && uiMode !== 'place')) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const msg = $('abMsg');
  const btns = $('abBtns');
  btns.innerHTML = '';

  if (uiMode === 'place') {
    const army = state.placementQueue[0];
    msg.innerHTML = `<b class="winner ${army}">Your placement (${army})</b> — click a highlighted empty territory to place a scout.`;
    return;
  }

  const cfg = state.config;
  const slotLines = human.slots.map((s) => {
    const cells = [...s.cont.terrs]
      .filter((t) => state.cells[t].army === human.army)
      .map((t) => fmtCell(cfg, t)).join(' ');
    const usable = slotUsable(s) ? '' : ' (locked by first-turn handicap)';
    return `[${cells}] budget ${s.remaining} · actions ${s.taken}/${human.maxActions}${usable}`;
  });
  const pools = Object.entries(human.bonusPool)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}+${v}`).join(' ');

  let hint;
  if (pending) {
    hint = pending.element === 'air'
      ? (pending.stage === 'mine'
        ? `air swap (sac ${pending.fuel}): click YOUR highlighted lone piece`
        : 'air swap: click the enemy piece to swap positions with')
      : `${pending.element} (sac ${pending.fuel}): click a highlighted target territory`;
  } else if (selCell !== null) {
    hint = 'green = move there, red = attack — or use a button below. Click another of your territories to switch.';
  } else {
    hint = 'click one of your territories to act with it, or end your turn.';
  }
  msg.innerHTML =
    `<b class="winner ${human.army}">Your turn (${human.army})</b> — ${hint}` +
    `<div class="muted">${slotLines.join('<br>')}${pools ? `<br>obelisk pools: ${pools}` : ''}</div>`;

  if (selCell !== null && !pending) {
    const pieces = [...new Set(state.cells[selCell].pieces)].sort((a, b) => b - a);
    if (pieces.length > 1) {
      for (const pv of pieces) {
        const b = addBtn(btns, `act with ${pv}`, () => { selPiece = pv; refreshMoveHighlights(); });
        if (pv === selPiece) b.classList.add('primary');
      }
    }
    const spawn = selActs.find((a) => a.type === 'spawn');
    if (spawn) addBtn(btns, 'spawn scout (cost 1)', () => execHuman(spawn));
    const evolve = selActs.find((a) => a.type === 'evolve');
    if (evolve) {
      const [hi, lo] = state.cells[selCell].pieces;
      addBtn(btns, `evolve ${lo}+${hi}→${hi + lo} (cost ${evolve.cost})`, () => execHuman(evolve));
    }
    const seen = new Set();
    for (const a of selActs.filter((x) => x.type === 'ability')) {
      const key = `${a.element}:${a.fuel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addBtn(btns, `${a.element} ability (sac ${a.fuel})`, () => startAbility(a.element, a.fuel));
    }
  }
  if (pending || selCell !== null) addBtn(btns, 'cancel', deselect);
  addBtn(btns, 'end turn', endHumanTurn, 'primary');
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
