// Frontend controller: watch single games turn-by-turn or auto-play, and run
// large batches in-browser. Same engine code as the CLI simulator.

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
let autoTimer = null;

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
  const config = readConfig();
  rng = mulberry32(parseInt($('seed').value, 10) || 1);
  engines = { A: makeEngine($('engineA').value), B: makeEngine($('engineB').value) };
  state = newGame(config);
  render();
}

// One click advances the game by exactly one army's worth of activity:
// during placement, one scout placement; during play, one army's turn.
function stepTurn() {
  if (!state || state.phase === 'over') return;
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
  render();
}

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  $('auto').textContent = '▶ Auto';
}

$('newGame').onclick = startGame;
$('step').onclick = () => { stopAuto(); stepTurn(); };
$('auto').onclick = () => {
  if (autoTimer) { stopAuto(); return; }
  if (!state || state.phase === 'over') startGame();
  $('auto').textContent = '⏸ Pause';
  autoTimer = setInterval(() => {
    stepTurn();
    if (!state || state.phase === 'over') stopAuto();
  }, 350);
};

// --- rendering --------------------------------------------------------------

function pieceEl(army, value) {
  const el = document.createElement('div');
  el.className = `piece ${army} p${Math.min(value, 8)}`;
  el.textContent = value;
  return el;
}

function render() {
  if (!state) return;
  const { config } = state;
  const board = $('board');
  board.style.gridTemplateColumns = `repeat(${config.width}, 84px)`;
  board.innerHTML = '';
  state.cells.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (c.army ? ` army-${c.army}` : '');
    const coord = document.createElement('span');
    coord.className = 'coord';
    coord.textContent = fmtCell(config, i);
    cell.appendChild(coord);
    for (const p of c.pieces) cell.appendChild(pieceEl(c.army, p));
    board.appendChild(cell);
  });

  // Obelisks sit on the corner points between cells (cell 84px + gap 6px).
  const pitch = 90;
  for (const ob of config.obelisks ?? []) {
    const st = obeliskStatus(state, ob);
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
    const sb = state.sideboard[army];
    for (const v of Object.keys(sb).map(Number).sort((a, b) => a - b)) {
      for (let k = 0; k < sb[v]; k++) row.appendChild(pieceEl(army, v));
    }
  }

  const status = $('status');
  if (state.phase === 'placement') {
    const army = state.placementQueue[0];
    status.innerHTML =
      `Placement — <span class="winner ${army}">Army ${army}</span> places a scout` +
      `<br>${state.placementQueue.length} placement${state.placementQueue.length === 1 ? '' : 's'} remaining`;
  } else if (state.phase === 'over') {
    if (state.winner === 'draw') {
      status.innerHTML = `Turn ${state.turn} — <span class="winner">draw</span> (${state.reason})`;
    } else {
      status.innerHTML = `Turn ${state.turn} — <span class="winner ${state.winner}">Army ${state.winner} wins</span> (${state.reason})`;
    }
  } else {
    const obSummary = ['A', 'B'].map((army) => {
      const held = (state.config.obelisks ?? [])
        .map((ob) => obeliskStatus(state, ob))
        .filter((st) => st.controller === army)
        .map((st) => `${st.element}+${st.bonus}`);
      return held.length ? `${army}: ${held.join(' ')}` : null;
    }).filter(Boolean).join(' · ');
    status.innerHTML =
      `Turn ${state.turn} — <span class="winner ${state.toMove}">Army ${state.toMove}</span> to move` +
      `<br>strength on board: A ${armyStrengthOnBoard(state, 'A')} · B ${armyStrengthOnBoard(state, 'B')}` +
      (obSummary ? `<br>obelisks — ${obSummary}` : '');
  }

  const log = $('log');
  log.innerHTML = '';
  const entries = state.log.slice(-120);
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
  // Chunked so the UI stays responsive on big runs.
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

startGame();
