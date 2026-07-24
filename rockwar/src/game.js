// Rock War core rules engine.
// Pure ES module — runs in Node and the browser. All state is plain JSON.
// Every rule that felt ambiguous in the spec is a config knob; see defaultConfig().

export const FIBS = [1, 2, 3, 5, 8, 13, 21, 34];

export function isFib(n) {
  return FIBS.includes(n);
}

// Two pieces may share a territory only if they are fibonacci-adjacent:
// (1,1), (1,2), (2,3), (3,5), (5,8), ...
export function fibAdjacent(a, b) {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (lo === 1 && hi === 1) return true;
  const i = FIBS.indexOf(lo);
  return i >= 0 && FIBS[i + 1] === hi;
}

export function defaultConfig() {
  return {
    width: 4,
    height: 4,
    // Per-army sideboard: value -> count. 5x1 + 3x2 + 2x3 + 1x5.
    supply: { 1: 5, 2: 3, 3: 2, 5: 1 },
    // Scouts each army places during the snake-placement phase; the rest of
    // the sideboard (including remaining scouts) enters play via spawning.
    initialScouts: 2,
    maxPiecesPerTerritory: 2,
    // Each contingent takes at most this many actions per turn...
    maxActionsPerContingent: 2,
    // ...whose fibonacci-valued costs sum to at most the contingent's strength.
    // Cost of an evolve action: 'smaller' | 'larger' | 'result' constituent value.
    evolveCost: 'smaller',
    // Per attack, how many scouts may retreat into EMPTY territories.
    // (Retreats into own-occupied territories are always free.)
    scoutRetreatBudget: 1,
    // Game is a draw after this many turns (one turn = one army's contingents acting).
    maxTurns: 200,
  };
}

export function other(army) {
  return army === 'A' ? 'B' : 'A';
}

export function idx(config, x, y) {
  return y * config.width + x;
}

export function xy(config, i) {
  return [i % config.width, Math.floor(i / config.width)];
}

export function neighbors(config, i) {
  const [x, y] = xy(config, i);
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < config.width - 1) out.push(i + 1);
  if (y > 0) out.push(i - config.width);
  if (y < config.height - 1) out.push(i + config.width);
  return out;
}

// Snake placement order: A B B A ... one scout per slot,
// until both armies have placed their initial scouts.
export function placementOrder(config) {
  const perArmy = Math.min(config.initialScouts ?? config.supply[1], config.supply[1]);
  const order = [];
  let a = 0, b = 0;
  const pattern = ['A', 'B', 'B', 'A'];
  let k = 0;
  while (a < perArmy || b < perArmy) {
    const who = pattern[k % 4];
    k++;
    if (who === 'A' && a < perArmy) { order.push('A'); a++; }
    else if (who === 'B' && b < perArmy) { order.push('B'); b++; }
  }
  return order;
}

export function newGame(config = defaultConfig()) {
  const cells = [];
  for (let i = 0; i < config.width * config.height; i++) {
    cells.push({ army: null, pieces: [] });
  }
  return {
    config,
    cells,
    sideboard: {
      A: { ...config.supply },
      B: { ...config.supply },
    },
    phase: 'placement', // 'placement' | 'play' | 'over'
    placementQueue: placementOrder(config),
    toMove: 'A',
    turn: 0,
    winner: null, // 'A' | 'B' | 'draw'
    reason: null, // 'elimination' | 'immobilized' | 'max-turns'
    log: [],
  };
}

function pushLog(state, text) {
  state.log.push({ turn: state.turn, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export function armyStrengthOnBoard(state, army) {
  let s = 0;
  for (const c of state.cells) {
    if (c.army === army) for (const p of c.pieces) s += p;
  }
  return s;
}

export function armyPieceCount(state, army) {
  let n = 0;
  for (const c of state.cells) if (c.army === army) n += c.pieces.length;
  return n;
}

// Can `piece` be added to `cell` (capacity + fibonacci-adjacency)?
export function canAddPiece(config, cell, piece) {
  if (cell.pieces.length >= config.maxPiecesPerTerritory) return false;
  return cell.pieces.every((p) => fibAdjacent(p, piece));
}

function addPiece(state, i, army, piece) {
  const cell = state.cells[i];
  cell.army = army;
  cell.pieces.push(piece);
  cell.pieces.sort((a, b) => b - a);
}

function removePiece(state, i, piece) {
  const cell = state.cells[i];
  const at = cell.pieces.indexOf(piece);
  if (at === -1) throw new Error(`no piece ${piece} at territory ${i}`);
  cell.pieces.splice(at, 1);
  if (cell.pieces.length === 0) cell.army = null;
}

// ---------------------------------------------------------------------------
// Placement phase
// ---------------------------------------------------------------------------

export function legalPlacements(state) {
  const out = [];
  state.cells.forEach((c, i) => { if (c.pieces.length === 0) out.push(i); });
  return out;
}

export function applyPlacement(state, army, i) {
  if (state.phase !== 'placement') throw new Error('not in placement phase');
  if (state.placementQueue[0] !== army) throw new Error(`not ${army}'s placement`);
  if (state.cells[i].pieces.length !== 0) throw new Error(`territory ${i} not empty`);
  if (state.sideboard[army][1] <= 0) throw new Error(`${army} has no scouts left`);
  state.sideboard[army][1]--;
  addPiece(state, i, army, 1);
  state.placementQueue.shift();
  pushLog(state, `${army} places scout at ${fmtCell(state.config, i)}`);
  if (state.placementQueue.length === 0) {
    state.phase = 'play';
    state.toMove = 'A';
    state.turn = 1;
  }
}

// ---------------------------------------------------------------------------
// Contingents
// ---------------------------------------------------------------------------

// A contingent is a maximal orthogonally-contiguous group of territories
// occupied by a single army. Its strength is the sum of its piece values.
export function contingents(state, army) {
  const seen = new Set();
  const out = [];
  state.cells.forEach((c, i) => {
    if (c.army !== army || seen.has(i)) return;
    const terrs = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const t = stack.pop();
      terrs.push(t);
      for (const n of neighbors(state.config, t)) {
        if (!seen.has(n) && state.cells[n].army === army) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    let strength = 0;
    for (const t of terrs) for (const p of state.cells[t].pieces) strength += p;
    out.push({ army, terrs: new Set(terrs), strength });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function moveCost(piece, targetCell) {
  if (piece === 1) return 1; // scouts always move for 1
  const occupant = targetCell.pieces.length ? targetCell.pieces[0] : 0;
  return Math.abs(piece - occupant);
}

export function evolveCostOf(config, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (config.evolveCost === 'larger') return hi;
  if (config.evolveCost === 'result') return lo + hi;
  return lo; // 'smaller'
}

// All legal actions for `cont` given the remaining fib budget and actions taken.
// Actions carry their cost. Contingent membership (cont.terrs) may have been
// extended mid-turn by moves/attacks — callers keep cont.terrs updated.
export function legalActions(state, cont, remainingBudget, actionsTaken) {
  const { config } = state;
  const acts = [];
  if (actionsTaken >= config.maxActionsPerContingent) return acts;
  const army = cont.army;

  for (const t of cont.terrs) {
    const cell = state.cells[t];
    if (cell.army !== army) continue; // vacated or captured mid-turn

    // Spawn: 1 scout from sideboard into an own territory of this contingent.
    if (
      state.sideboard[army][1] > 0 &&
      remainingBudget >= 1 &&
      canAddPiece(config, cell, 1)
    ) {
      acts.push({ type: 'spawn', to: t, cost: 1 });
    }

    // Evolve: combine the two co-located pieces into their sum, if the
    // sideboard has a piece of that value available.
    if (cell.pieces.length === 2) {
      const [hi, lo] = cell.pieces;
      const sum = hi + lo;
      if ((state.sideboard[army][sum] || 0) > 0) {
        const cost = evolveCostOf(config, hi, lo);
        if (isFib(cost) && cost <= remainingBudget) {
          acts.push({ type: 'evolve', at: t, cost });
        }
      }
    }

    // Moves and attacks, per distinct piece value in the cell.
    for (const p of new Set(cell.pieces)) {
      for (const n of neighbors(config, t)) {
        const nc = state.cells[n];
        if (nc.army === null || nc.army === army) {
          if (!canAddPiece(config, nc, p)) continue;
          const cost = moveCost(p, nc);
          if (cost >= 1 && isFib(cost) && cost <= remainingBudget) {
            acts.push({ type: 'move', from: t, piece: p, to: n, cost });
          }
        } else {
          // Attack: cost equals the attacking piece's value.
          if (p <= remainingBudget) {
            acts.push({ type: 'attack', from: t, piece: p, to: n, cost: p });
          }
        }
      }
    }
  }
  return acts;
}

// Retreat options for the defenders of territory `t`.
// Returns one entry per defending piece (by index into cell.pieces):
// { piece, dests: [terr indices into own-occupied cells],
//   emptyDests: [empty terr indices, scouts only] }
export function retreatOptions(state, t, army) {
  const { config } = state;
  const cell = state.cells[t];
  return cell.pieces.map((piece) => {
    const dests = [];
    const emptyDests = [];
    for (const n of neighbors(config, t)) {
      const nc = state.cells[n];
      if (nc.army === army && canAddPiece(config, nc, piece)) dests.push(n);
      else if (nc.army === null && piece === 1) emptyDests.push(n);
    }
    return { piece, dests, emptyDests };
  });
}

function resolveAttack(state, army, action, engines, rng) {
  const { config } = state;
  const defArmy = other(army);
  const defCell = state.cells[action.to];
  const attackInfo = {
    attacker: army,
    defender: defArmy,
    from: action.from,
    to: action.to,
    piece: action.piece,
  };

  // Defending engine plans retreats: [{ piece, dest } ...].
  const options = retreatOptions(state, action.to, defArmy);
  let plan = [];
  const eng = engines && engines[defArmy];
  if (eng && eng.planRetreats) {
    plan = eng.planRetreats(state, attackInfo, options, rng) || [];
  }

  // Validate and apply retreats sequentially against the evolving state.
  let scoutBudget = config.scoutRetreatBudget;
  for (const r of plan) {
    if (!r) continue;
    if (!defCell.pieces.includes(r.piece)) continue;
    if (!neighbors(config, action.to).includes(r.dest)) continue;
    const destCell = state.cells[r.dest];
    if (destCell.army === defArmy) {
      if (!canAddPiece(config, destCell, r.piece)) continue;
    } else if (destCell.army === null) {
      if (r.piece !== 1 || scoutBudget <= 0) continue;
      scoutBudget--;
    } else {
      continue; // can't retreat into enemy territory
    }
    removePiece(state, action.to, r.piece);
    addPiece(state, r.dest, defArmy, r.piece);
    pushLog(state, `${defArmy} retreats ${r.piece} ${fmtCell(config, action.to)}→${fmtCell(config, r.dest)}`);
  }

  // Pieces that did not retreat are destroyed if the attacking piece's value
  // is at least their combined value; otherwise the attack fails.
  const remaining = defCell.pieces;
  const defSum = remaining.reduce((s, p) => s + p, 0);
  let destroyed = [];
  if (remaining.length > 0) {
    if (action.piece >= defSum) {
      destroyed = [...remaining];
      defCell.pieces = [];
      defCell.army = null;
      pushLog(state, `${army} ${action.piece} destroys [${destroyed.join(',')}] at ${fmtCell(config, action.to)}`);
    } else {
      pushLog(state, `${army} ${action.piece} attack on ${fmtCell(config, action.to)} repelled (def ${defSum})`);
      return { advanced: false, destroyed };
    }
  }

  // Territory is now empty (by retreat and/or destruction): attacker advances.
  removePiece(state, action.from, action.piece);
  addPiece(state, action.to, army, action.piece);
  if (destroyed.length === 0) {
    pushLog(state, `${army} ${action.piece} captures ${fmtCell(config, action.to)}`);
  }
  return { advanced: true, destroyed };
}

// Applies a single validated action. Returns { capturedTerritory } so the
// turn loop can extend the acting contingent's territory set.
export function applyAction(state, army, action, engines, rng) {
  const { config } = state;
  switch (action.type) {
    case 'spawn': {
      state.sideboard[army][1]--;
      addPiece(state, action.to, army, 1);
      pushLog(state, `${army} spawns scout at ${fmtCell(config, action.to)}`);
      return {};
    }
    case 'move': {
      removePiece(state, action.from, action.piece);
      addPiece(state, action.to, army, action.piece);
      pushLog(state, `${army} moves ${action.piece} ${fmtCell(config, action.from)}→${fmtCell(config, action.to)} (cost ${action.cost})`);
      return { capturedTerritory: action.to };
    }
    case 'evolve': {
      const cell = state.cells[action.at];
      const [hi, lo] = cell.pieces;
      const sum = hi + lo;
      state.sideboard[army][hi]++;
      state.sideboard[army][lo]++;
      state.sideboard[army][sum]--;
      cell.pieces = [sum];
      pushLog(state, `${army} evolves ${lo}+${hi}→${sum} at ${fmtCell(config, action.at)}`);
      return {};
    }
    case 'attack': {
      const res = resolveAttack(state, army, action, engines, rng);
      return res.advanced ? { capturedTerritory: action.to } : {};
    }
    default:
      throw new Error(`unknown action type ${action.type}`);
  }
}

// ---------------------------------------------------------------------------
// Turn loop
// ---------------------------------------------------------------------------

function checkElimination(state) {
  for (const army of ['A', 'B']) {
    if (armyPieceCount(state, army) === 0) {
      state.phase = 'over';
      state.winner = other(army);
      state.reason = 'elimination';
      pushLog(state, `${other(army)} wins: ${army} eliminated`);
      return true;
    }
  }
  return false;
}

// Plays one full turn for state.toMove: every contingent (snapshotted at turn
// start) takes up to maxActionsPerContingent actions within its fib budget.
export function playTurn(state, engines, rng) {
  if (state.phase !== 'play') return state;
  const army = state.toMove;
  const { config } = state;

  if (checkElimination(state)) return state;

  const conts = contingents(state, army);

  // Loss by immobilization: no contingent has any legal action.
  const anyLegal = conts.some((c) => legalActions(state, c, c.strength, 0).length > 0);
  if (!anyLegal) {
    state.phase = 'over';
    state.winner = other(army);
    state.reason = 'immobilized';
    pushLog(state, `${other(army)} wins: ${army} cannot act`);
    return state;
  }

  for (const cont of conts) {
    let remaining = cont.strength;
    let taken = 0;
    while (taken < config.maxActionsPerContingent && state.phase === 'play') {
      const acts = legalActions(state, cont, remaining, taken);
      if (acts.length === 0) break;
      const choice = engines[army].chooseAction(
        state,
        { army, contingent: cont, remainingBudget: remaining, actionsTaken: taken },
        acts,
        rng
      );
      if (!choice) break; // engine passes
      // Only accept an action from the legal list.
      const match = acts.find((a) => JSON.stringify(a) === JSON.stringify(choice));
      if (!match) break;
      const res = applyAction(state, army, match, engines, rng);
      if (res.capturedTerritory !== undefined) cont.terrs.add(res.capturedTerritory);
      remaining -= match.cost;
      taken++;
      if (checkElimination(state)) return state;
    }
  }

  state.toMove = other(army);
  state.turn++;
  if (state.turn > config.maxTurns) {
    state.phase = 'over';
    state.winner = 'draw';
    state.reason = 'max-turns';
    pushLog(state, `draw: turn limit ${config.maxTurns} reached`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Full game driver
// ---------------------------------------------------------------------------

// engines: { A, B }, each implementing:
//   placeScout(state, army, rng) -> territory index
//   chooseAction(state, ctx, legalActions, rng) -> one of legalActions, or null to pass
//   planRetreats(state, attackInfo, options, rng) -> [{ piece, dest }, ...]
export function playGame({ engines, config = defaultConfig(), rng, onState }) {
  const state = newGame(config);
  while (state.phase === 'placement') {
    const army = state.placementQueue[0];
    let i = engines[army].placeScout(state, army, rng);
    if (typeof i !== 'number' || !state.cells[i] || state.cells[i].pieces.length !== 0) {
      i = legalPlacements(state)[0]; // fallback for a misbehaving engine
    }
    applyPlacement(state, army, i);
    if (onState) onState(state);
  }
  while (state.phase === 'play') {
    playTurn(state, engines, rng);
    if (onState) onState(state);
  }
  return state;
}

export function fmtCell(config, i) {
  const [x, y] = xy(config, i);
  return `${'abcdefgh'[x]}${y + 1}`;
}
