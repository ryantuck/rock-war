// Rock War core rules engine.
// Pure ES module — runs in Node and the browser. All state is plain JSON.
// Every rule that felt ambiguous in the spec is a config knob; see defaultConfig().

export const FIBS = [1, 2, 3, 5, 8, 13, 21, 34];

export function isFib(n) {
  return FIBS.includes(n);
}

// Fibonacci constituents of a piece: what it devolves into (and what evolves
// into it). Every constituent pair is fib-adjacent, so it fits one territory.
export function fibParts(p) {
  if (p === 2) return [1, 1];
  const i = FIBS.indexOf(p);
  if (i <= 0) return []; // scouts have no constituents
  return [FIBS[i - 1], FIBS[i - 2]];
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
    width: 5,
    height: 5,
    // Per-army sideboard: value -> count. 8 scouts, 5 warriors, 3 chieftains,
    // 2 warlords, 1 behemoth — fibonacci counts of fibonacci values, 45 pts.
    supply: { 1: 8, 2: 5, 3: 3, 5: 2, 8: 1 },
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
    // How a connecting attack (attacker value >= non-retreated defenders'
    // sum) resolves:
    //   'devolve'           — an exact tie destroys everything (2 vs (2):
    //                         all pieces die). A strictly greater attacker
    //                         kills the defenders; if their sum exceeds
    //                         devolveThreshold x attacker, it devolves into
    //                         its fibonacci constituents (3→2+1, 5→3+2,
    //                         8→5+3) via the sideboard; otherwise it
    //                         survives intact. Either way it advances.
    //                         E.g. 3 vs (2): the 2 dies and the 3 lands as
    //                         (2,1); 3 vs (1): the 1 just dies.
    //   'margin'            — defenders die; the attacker dies only on an
    //                         exact tie
    //   'mutual'            — the attacker always dies with the defenders
    //   'attacker-survives' — the attacker always survives and advances
    combatRule: 'devolve',
    // Devolution triggers when defense > this fraction of the attacker.
    devolveThreshold: 0.5,
    // Minimum piece value that may attack: scouts (1) cannot attack.
    minAttackValue: 2,
    // First-turn handicap: the first player acts with at most this many
    // contingents on turn 1 (their engine chooses which). null = no handicap.
    firstTurnContingents: 1,
    // First-turn handicap: each acting contingent takes at most this many
    // actions on turn 1. null = no cap beyond maxActionsPerContingent.
    firstTurnActions: 1,
    // Obelisks sit on interior corner points where four territories meet:
    // corner [cx, cy] touches cells (cx-1,cy-1) (cx,cy-1) (cx-1,cy) (cx,cy).
    // Each element grants bonus budget for its mechanic while controlled:
    // fire → attack, earth → evolve, air → move, water → spawn.
    obelisks: [
      { element: 'fire', corner: [1, 1] },
      { element: 'earth', corner: [4, 1] },
      { element: 'air', corner: [1, 4] },
      { element: 'water', corner: [4, 4] },
    ],
    // Controlled obelisks also grant an active ability, once per obelisk per
    // turn (no budget cost — the piece spent is the price). The fuel is
    // always one of YOUR SCOUTS standing in a territory adjacent to that
    // obelisk; targets can be anywhere:
    //   fire  — sacrifice the scout to slay an enemy scout in any territory
    //   water — return the scout to bounce an enemy piece of strength <= 2
    //           back to its owner's sideboard
    //   earth — return the scout to devolve any enemy warrior in place
    //   air   — return the scout to displace ANY enemy piece into an
    //           adjacent legal territory of your choice
    obeliskAbilities: true,
    // Controlled obelisks also project passive defensive powers, army-wide,
    // while control holds (magnitudes scale with the obelisk's bonus tier):
    //   air   — the defender's scout-retreat-into-empty budget is increased
    //           by the air bonus on every attack against them
    //   water — the defender's pieces that would die in combat return to
    //           their sideboard instead
    //   earth — attacking the earth-holder's territories costs the attacker
    //           piece value + the earth bonus
    obeliskPowers: true,
    // Controlling this many obelisks simultaneously wins the game on the
    // spot. Control means holding the strictly greatest adjacent value of at
    // least 3 across at least 2 of an obelisk's adjacent territories.
    obeliskVictory: true,
    obeliskVictoryCount: 3,
    // Control requires occupying >= 2 of the obelisk's adjacent territories
    // with the strictly greatest total adjacent piece value, which must reach
    // the first tier. Bonuses scale fibonacci with the tier reached:
    // value >= 3 → +1 budget, >= 5 → +2, >= 8 → +3, >= 13 → +5, >= 21 → +8.
    obeliskTiers: [3, 5, 8, 13, 21, 34],
    // Game ends after this many turns (one turn = one army's contingents
    // acting). With turnLimitTiebreak, the army with more board strength
    // wins at the cap (controlled obelisks break a strength tie); it's only
    // a draw if both are dead even.
    maxTurns: 200,
    turnLimitTiebreak: true,
  };
}

export function other(army) {
  return army === 'A' ? 'B' : 'A';
}

// Resolves the combat rule, honoring the legacy mutualDestruction boolean
// from older saved configs.
export function combatRuleOf(config) {
  if (config.combatRule) return config.combatRule;
  if (config.mutualDestruction === true) return 'mutual';
  if (config.mutualDestruction === false) return 'attacker-survives';
  return 'margin';
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

// ---------------------------------------------------------------------------
// Obelisks
// ---------------------------------------------------------------------------

export const ELEMENT_ACTIONS = { fire: 'attack', earth: 'evolve', air: 'move', water: 'spawn' };

// The up-to-4 territories touching an obelisk's corner point.
export function obeliskCells(config, corner) {
  const [cx, cy] = corner;
  const out = [];
  for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
    if (x >= 0 && x < config.width && y >= 0 && y < config.height) out.push(idx(config, x, y));
  }
  return out;
}

// Who controls this obelisk, and at what bonus tier?
export function obeliskStatus(state, ob) {
  const cells = obeliskCells(state.config, ob.corner);
  const score = { A: 0, B: 0 };
  const count = { A: 0, B: 0 };
  for (const i of cells) {
    const c = state.cells[i];
    if (!c.army) continue;
    count[c.army]++;
    for (const p of c.pieces) score[c.army] += p;
  }
  const tiers = state.config.obeliskTiers ?? [3, 5, 8, 13, 21, 34];
  let controller = null;
  for (const army of ['A', 'B']) {
    if (count[army] >= 2 && score[army] >= tiers[0] && score[army] > score[other(army)]) {
      controller = army;
    }
  }
  let bonus = 0;
  if (controller) {
    // Fibonacci scaling: tier thresholds [3,5,8,13,...] grant [1,2,3,5,...].
    for (let i = 0; i < tiers.length; i++) if (score[controller] >= tiers[i]) bonus = FIBS[i];
  }
  return { element: ob.element, action: ELEMENT_ACTIONS[ob.element], controller, bonus, score, count };
}

// Bonus tier of `element` if `army` controls it, else 0. Used by the passive
// obelisk powers (air retreat budget, water combat saves, earth attack tax).
export function obeliskElementBonus(state, army, element) {
  if (state.config.obeliskPowers === false) return 0;
  for (const ob of state.config.obelisks ?? []) {
    if (ob.element !== element) continue;
    const st = obeliskStatus(state, ob);
    if (st.controller === army) return st.bonus;
  }
  return 0;
}

// Per-turn bonus budget pools by action type for `army`, e.g. { attack: 1 }.
export function obeliskBonuses(state, army) {
  const pool = {};
  for (const ob of state.config.obelisks ?? []) {
    const st = obeliskStatus(state, ob);
    if (st.controller === army && st.bonus > 0) {
      pool[st.action] = (pool[st.action] || 0) + st.bonus;
    }
  }
  return pool;
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
    abilitiesUsedThisTurn: [], // obelisk elements whose ability fired this turn
    log: [],
    // Structured event stream for frontends: one entry per visual step,
    // grouped into actions by `seq`. When captureSnapshots is set on the
    // state, each event also carries an `after` board snapshot.
    events: [],
    eventSeq: 0,
  };
}

function pushLog(state, text) {
  state.log.push({ turn: state.turn, text, seq: state.eventSeq ?? 0 });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

// Emit a structured event (see newGame). Events power the frontend's
// per-action animation; sims simply ignore them.
function emitEvent(state, ev) {
  if (!state.events) return;
  ev.seq = state.eventSeq ?? 0;
  if (state.captureSnapshots) {
    ev.after = {
      cells: state.cells.map((c) => ({ army: c.army, pieces: [...c.pieces] })),
      sideboard: { A: { ...state.sideboard.A }, B: { ...state.sideboard.B } },
    };
  }
  state.events.push(ev);
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
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  state.sideboard[army][1]--;
  addPiece(state, i, army, 1);
  emitEvent(state, { type: 'place', army, to: i });
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
// bonusPool holds obelisk bonus budget by action type ({ attack: 1, ... }).
// Within the action cap, an action is affordable from budget + type bonus.
// BEYOND the cap, obelisk bonuses grant extra actions: an action is legal
// only if its full cost is covered by its type's bonus pool.
export function legalActions(state, cont, remainingBudget, actionsTaken, bonusPool = {},
                             actionCap = state.config.maxActionsPerContingent) {
  const acts = [];
  const { config } = state;
  const army = cont.army;
  const beyondCap = actionsTaken >= actionCap;
  const afford = (type, cost) => beyondCap
    ? cost <= (bonusPool[type] || 0)
    : cost <= remainingBudget + (bonusPool[type] || 0);
  // Earth power: attacking the earth-holder's territories costs extra.
  const earthTax = obeliskElementBonus(state, other(army), 'earth');

  for (const t of cont.terrs) {
    const cell = state.cells[t];
    if (cell.army !== army) continue; // vacated or captured mid-turn

    // Spawn: 1 scout from sideboard into an own territory of this contingent.
    if (
      state.sideboard[army][1] > 0 &&
      afford('spawn', 1) &&
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
        if (isFib(cost) && afford('evolve', cost)) {
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
          if (cost >= 1 && isFib(cost) && afford('move', cost)) {
            acts.push({ type: 'move', from: t, piece: p, to: n, cost });
          }
        } else {
          // Attack: cost equals the attacking piece's value. Pieces below
          // minAttackValue (scouts by default) cannot attack, and attacking
          // requires value >= the target territory's total — a weaker attack
          // could never connect (defenders would simply stand and repel it).
          const defSum = nc.pieces.reduce((s, x) => s + x, 0);
          if (p >= (config.minAttackValue ?? 1) && p >= defSum && afford('attack', p + earthTax)) {
            acts.push({ type: 'attack', from: t, piece: p, to: n, cost: p + earthTax });
          }
        }
      }
    }
  }

  // Obelisk abilities: once per controlled obelisk per player-turn,
  // budget-free (the spent scout is the price), fueled from this contingent.
  // Not available as bonus-funded extra actions — they respect the cap.
  if (!beyondCap) acts.push(...abilityActions(state, army, cont.terrs));
  return acts;
}

// All obelisk ability actions available to `army` right now. When cellFilter
// (a Set of territory indices) is given, fuel scouts must stand in it — the
// contingent restriction during the army's own turn. Without it, any
// obelisk-adjacent scout qualifies (used for reactions on the enemy's turn).
export function abilityActions(state, army, cellFilter = null) {
  const { config } = state;
  const acts = [];
  if (!config.obeliskAbilities) return acts;
  const enemy = other(army);
  for (const ob of config.obelisks ?? []) {
    if ((state.abilitiesUsedThisTurn ?? []).includes(ob.element)) continue;
    if (obeliskStatus(state, ob).controller !== army) continue;
    // Fuel: one of our scouts standing adjacent to THIS obelisk.
    for (const t of obeliskCells(config, ob.corner)) {
      if (cellFilter && !cellFilter.has(t)) continue;
      const cell = state.cells[t];
      if (cell.army !== army || !cell.pieces.includes(1)) continue;
      state.cells.forEach((ec, e) => {
        if (ec.army !== enemy) return;
        if (ob.element === 'fire') {
          if (ec.pieces.includes(1)) {
            acts.push({ type: 'ability', element: 'fire', from: t, target: e, cost: 0 });
          }
        } else if (ob.element === 'water') {
          for (const v of new Set(ec.pieces)) {
            if (v <= 2) acts.push({ type: 'ability', element: 'water', from: t, target: e, piece: v, cost: 0 });
          }
        } else if (ob.element === 'earth') {
          if (ec.pieces.includes(2)) {
            acts.push({ type: 'ability', element: 'earth', from: t, target: e, cost: 0 });
          }
        } else if (ob.element === 'air') {
          for (const v of new Set(ec.pieces)) {
            for (const d of neighbors(config, e)) {
              const dc = state.cells[d];
              if ((dc.army === null || dc.army === enemy) && canAddPiece(config, dc, v)) {
                acts.push({ type: 'ability', element: 'air', from: t, target: e, piece: v, dest: d, cost: 0 });
              }
            }
          }
        }
      });
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
  // Air power: the defender's empty-territory retreat budget grows with
  // their air-obelisk bonus.
  let scoutBudget = (config.scoutRetreatBudget ?? 1) + obeliskElementBonus(state, defArmy, 'air');
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
    emitEvent(state, { type: 'retreat', army: defArmy, piece: r.piece, from: action.to, to: r.dest });
    pushLog(state, `${defArmy} retreats ${r.piece} ${fmtCell(config, action.to)}→${fmtCell(config, r.dest)}`);
  }

  // Pieces that did not retreat are destroyed if the attacking piece's value
  // is at least their combined value; otherwise the attack fails.
  const remaining = defCell.pieces;
  const defSum = remaining.reduce((s, p) => s + p, 0);
  let destroyed = [];
  const rule = combatRuleOf(config);
  // Water power: the defender's fallen pieces return to their sideboard
  // instead of leaving the game.
  const waterSave = obeliskElementBonus(state, defArmy, 'water') > 0;
  const fellDefenders = () => {
    if (!waterSave) {
      emitEvent(state, { type: 'destroyed', army: defArmy, pieces: destroyed, at: action.to });
      return 'destroys';
    }
    for (const p of destroyed) {
      state.sideboard[defArmy][p]++;
      emitEvent(state, { type: 'toSideboard', army: defArmy, piece: p, from: action.to });
    }
    return 'breaks (water returns)';
  };
  if (remaining.length > 0) {
    if (action.piece >= defSum) {
      destroyed = [...remaining];
      defCell.pieces = [];
      defCell.army = null;
      const attackerDies =
        rule === 'mutual' ||
        ((rule === 'margin' || rule === 'devolve') && action.piece === defSum);
      if (attackerDies) {
        removePiece(state, action.from, action.piece);
        const verb = fellDefenders();
        emitEvent(state, { type: 'destroyed', army, pieces: [action.piece], at: action.from });
        pushLog(state, `${army} ${action.piece} ${verb} [${destroyed.join(',')}] at ${fmtCell(config, action.to)} and dies`);
        return { advanced: false, destroyed };
      }
      // Devolution: breaking a defense worth more than half the attacker
      // splits the attacker into its fibonacci constituents (via sideboard).
      if (rule === 'devolve' && defSum > action.piece * (config.devolveThreshold ?? 0.5)) {
        const verb = fellDefenders();
        removePiece(state, action.from, action.piece);
        state.sideboard[army][action.piece] = (state.sideboard[army][action.piece] || 0) + 1;
        const placed = [];
        for (const part of fibParts(action.piece)) {
          if ((state.sideboard[army][part] || 0) > 0) {
            state.sideboard[army][part]--;
            addPiece(state, action.to, army, part);
            placed.push(part);
          }
        }
        emitEvent(state, { type: 'attackDevolve', army, piece: action.piece, from: action.from, to: action.to, parts: placed });
        pushLog(state, `${army} ${action.piece} ${verb} [${destroyed.join(',')}] and devolves to (${placed.join(',') || 'nothing'}) at ${fmtCell(config, action.to)}`);
        return { advanced: placed.length > 0, destroyed };
      }
      const verb = fellDefenders();
      pushLog(state, `${army} ${action.piece} ${verb} [${destroyed.join(',')}] at ${fmtCell(config, action.to)}`);
    } else {
      pushLog(state, `${army} ${action.piece} attack on ${fmtCell(config, action.to)} repelled (def ${defSum})`);
      return { advanced: false, destroyed };
    }
  }

  // Territory is now empty (by retreat and/or destruction): attacker advances.
  removePiece(state, action.from, action.piece);
  addPiece(state, action.to, army, action.piece);
  emitEvent(state, { type: 'move', army, piece: action.piece, from: action.from, to: action.to });
  if (destroyed.length === 0) {
    pushLog(state, `${army} ${action.piece} captures ${fmtCell(config, action.to)}`);
  }
  return { advanced: true, destroyed };
}

// Devolve `piece` where it stands: it returns to the sideboard and its
// fibonacci constituents deploy in its place (parts missing from the
// sideboard are lost). Returns the parts actually placed.
function devolveInPlace(state, army, cellIdx, piece) {
  removePiece(state, cellIdx, piece);
  state.sideboard[army][piece] = (state.sideboard[army][piece] || 0) + 1;
  const placed = [];
  for (const part of fibParts(piece)) {
    // Constituents deploy only where the sideboard has them AND the cell can
    // legally hold them (a 2 devolving next to a 3 can't seat its 1s — those
    // parts stay in the sideboard as stock instead).
    if ((state.sideboard[army][part] || 0) > 0 &&
        canAddPiece(state.config, state.cells[cellIdx], part)) {
      state.sideboard[army][part]--;
      addPiece(state, cellIdx, army, part);
      placed.push(part);
    }
  }
  return placed;
}

function resolveAbility(state, army, action) {
  const { config } = state;
  const enemy = other(army);
  state.abilitiesUsedThisTurn.push(action.element);
  switch (action.element) {
    case 'fire': {
      // Sacrifice a scout to slay an enemy scout anywhere. Both leave the game.
      removePiece(state, action.from, 1);
      emitEvent(state, { type: 'sacrifice', army, piece: 1, at: action.from });
      removePiece(state, action.target, 1);
      emitEvent(state, { type: 'destroyed', army: enemy, pieces: [1], at: action.target });
      pushLog(state, `${army} fire ability: sacrifices scout at ${fmtCell(config, action.from)} to slay ${enemy} scout at ${fmtCell(config, action.target)}`);
      return;
    }
    case 'water': {
      // Return a scout home to bounce an enemy piece (<=2) to its sideboard.
      removePiece(state, action.from, 1);
      state.sideboard[army][1]++;
      emitEvent(state, { type: 'toSideboard', army, piece: 1, from: action.from });
      removePiece(state, action.target, action.piece);
      state.sideboard[enemy][action.piece]++;
      emitEvent(state, { type: 'toSideboard', army: enemy, piece: action.piece, from: action.target });
      pushLog(state, `${army} water ability: returns scout at ${fmtCell(config, action.from)}, bouncing ${enemy} ${action.piece} at ${fmtCell(config, action.target)} to sideboard`);
      return;
    }
    case 'earth': {
      // Return a scout home to devolve an enemy warrior where it stands.
      removePiece(state, action.from, 1);
      state.sideboard[army][1]++;
      emitEvent(state, { type: 'toSideboard', army, piece: 1, from: action.from });
      const placed = devolveInPlace(state, enemy, action.target, 2);
      emitEvent(state, { type: 'devolved', army: enemy, piece: 2, at: action.target, parts: placed });
      pushLog(state, `${army} earth ability: returns scout at ${fmtCell(config, action.from)}, devolving ${enemy} warrior at ${fmtCell(config, action.target)} to (${placed.join(',') || 'sideboard'})`);
      return;
    }
    case 'air': {
      // Return a scout home to displace any enemy piece one territory.
      removePiece(state, action.from, 1);
      state.sideboard[army][1]++;
      emitEvent(state, { type: 'toSideboard', army, piece: 1, from: action.from });
      removePiece(state, action.target, action.piece);
      addPiece(state, action.dest, enemy, action.piece);
      emitEvent(state, { type: 'move', army: enemy, piece: action.piece, from: action.target, to: action.dest });
      pushLog(state, `${army} air ability: returns scout at ${fmtCell(config, action.from)}, displacing ${enemy} ${action.piece} ${fmtCell(config, action.target)}→${fmtCell(config, action.dest)}`);
      return;
    }
    default:
      throw new Error(`unknown ability element ${action.element}`);
  }
}

// Applies a single validated action. Returns { capturedTerritory } so the
// turn loop can extend the acting contingent's territory set.
export function applyAction(state, army, action, engines, rng) {
  const { config } = state;
  switch (action.type) {
    case 'spawn': {
      state.sideboard[army][1]--;
      addPiece(state, action.to, army, 1);
      emitEvent(state, { type: 'spawn', army, to: action.to });
      pushLog(state, `${army} spawns scout at ${fmtCell(config, action.to)}`);
      return {};
    }
    case 'move': {
      removePiece(state, action.from, action.piece);
      addPiece(state, action.to, army, action.piece);
      emitEvent(state, { type: 'move', army, piece: action.piece, from: action.from, to: action.to });
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
      emitEvent(state, { type: 'evolve', army, at: action.at, parts: [hi, lo], result: sum });
      pushLog(state, `${army} evolves ${lo}+${hi}→${sum} at ${fmtCell(config, action.at)}`);
      return {};
    }
    case 'attack': {
      const res = resolveAttack(state, army, action, engines, rng);
      return res.advanced ? { capturedTerritory: action.to } : {};
    }
    case 'ability': {
      resolveAbility(state, army, action);
      return {};
    }
    default:
      throw new Error(`unknown action type ${action.type}`);
  }
}

// ---------------------------------------------------------------------------
// Turn loop
// ---------------------------------------------------------------------------

function checkElimination(state) {
  const aOut = armyPieceCount(state, 'A') === 0;
  const bOut = armyPieceCount(state, 'B') === 0;
  if (aOut || bOut) {
    state.phase = 'over';
    if (aOut && bOut) {
      // Mutual destruction can wipe both boards at once.
      state.winner = 'draw';
      state.reason = 'mutual-elimination';
      pushLog(state, 'draw: both armies eliminated');
    } else {
      const loser = aOut ? 'A' : 'B';
      state.winner = other(loser);
      state.reason = 'elimination';
      pushLog(state, `${other(loser)} wins: ${loser} eliminated`);
    }
    return true;
  }
  // Obelisk victory: controlling enough obelisks at once wins immediately.
  if (state.config.obeliskVictory !== false) {
    const obs = state.config.obelisks ?? [];
    const need = state.config.obeliskVictoryCount ?? obs.length;
    if (obs.length > 0 && need > 0) {
      const held = { A: 0, B: 0 };
      for (const ob of obs) {
        const c = obeliskStatus(state, ob).controller;
        if (c) held[c]++;
      }
      for (const army of ['A', 'B']) {
        if (held[army] >= need) {
          state.phase = 'over';
          state.winner = army;
          state.reason = 'obelisks';
          pushLog(state, `${army} wins: controls ${held[army]} obelisks`);
          return true;
        }
      }
    }
  }
  return false;
}

// Reaction window: after each of the active player's actions, the other army
// may fire its unused obelisk abilities (any obelisk-adjacent scout as fuel,
// no budget or action cost). Engines opt in via chooseReaction; loop is
// bounded by the once-per-element-per-turn ledger.
function offerReactions(state, reactor, engines, rng) {
  const eng = engines[reactor];
  if (!eng || !eng.chooseReaction) return;
  while (state.phase === 'play') {
    const opts = abilityActions(state, reactor);
    if (opts.length === 0) return;
    const choice = eng.chooseReaction(state, reactor, opts, rng);
    if (!choice) return;
    const match = opts.find((o) => JSON.stringify(o) === JSON.stringify(choice));
    if (!match) return;
    state.eventSeq = (state.eventSeq ?? 0) + 1;
    applyAction(state, reactor, match, engines, rng);
    if (checkElimination(state)) return;
  }
}

// Plays one full turn for state.toMove: every contingent (snapshotted at turn
// start) takes up to maxActionsPerContingent actions within its fib budget.
export function playTurn(state, engines, rng) {
  if (state.phase !== 'play') return state;
  const army = state.toMove;
  const { config } = state;

  if (checkElimination(state)) return state;

  const conts = contingents(state, army);
  state.abilitiesUsedThisTurn = []; // each obelisk ability fires once per turn

  // Obelisk bonus budget pools for this turn, by action type. Army-wide:
  // contingents draw from them first-come, and they reset every turn.
  const bonusPool = obeliskBonuses(state, army);

  // Loss by immobilization: no contingent has any legal action.
  const anyLegal = conts.some((c) => legalActions(state, c, c.strength, 0, bonusPool).length > 0);
  if (!anyLegal) {
    state.phase = 'over';
    state.winner = other(army);
    state.reason = 'immobilized';
    pushLog(state, `${other(army)} wins: ${army} cannot act`);
    return state;
  }

  // First-turn handicap: on turn 1 the opening player acts with at most
  // config.firstTurnContingents contingents; their engine picks which.
  let acting = conts;
  const limit = state.turn === 1 ? (config.firstTurnContingents ?? Infinity) : Infinity;
  if (Number.isFinite(limit) && conts.length > limit) {
    let chosen = engines[army].chooseContingents
      ? engines[army].chooseContingents(state, conts, limit, rng)
      : null;
    if (Array.isArray(chosen)) chosen = chosen.filter((c) => conts.includes(c)).slice(0, limit);
    if (!Array.isArray(chosen) || chosen.length === 0) {
      // Fallback: strongest contingents that can actually do something.
      const usable = conts.filter((c) => legalActions(state, c, c.strength, 0).length > 0);
      chosen = (usable.length ? usable : conts)
        .slice()
        .sort((x, y) => y.strength - x.strength)
        .slice(0, limit);
    }
    acting = chosen;
    pushLog(state, `${army} first-turn handicap: ${acting.length} of ${conts.length} contingents may act`);
  }

  // First-turn handicap: cap actions per contingent on turn 1.
  const maxActions = state.turn === 1
    ? Math.min(config.maxActionsPerContingent, config.firstTurnActions ?? Infinity)
    : config.maxActionsPerContingent;

  for (const cont of acting) {
    let remaining = cont.strength;
    let taken = 0;
    // Loop past maxActions: obelisk bonuses fund extra actions beyond the cap
    // (legalActions only offers fully-bonus-funded actions there), so a
    // contingent can e.g. spawn, evolve, then attack on the fire kicker.
    while (state.phase === 'play') {
      const acts = legalActions(state, cont, remaining, taken, bonusPool, maxActions);
      if (acts.length === 0) break;
      const choice = engines[army].chooseAction(
        state,
        { army, contingent: cont, remainingBudget: remaining, actionsTaken: taken, bonusPool },
        acts,
        rng
      );
      if (!choice) break; // engine passes
      // Only accept an action from the legal list.
      const match = acts.find((a) => JSON.stringify(a) === JSON.stringify(choice));
      if (!match) break;
      const beyondCap = taken >= maxActions;
      state.eventSeq = (state.eventSeq ?? 0) + 1;
      const res = applyAction(state, army, match, engines, rng);
      if (res.capturedTerritory !== undefined) cont.terrs.add(res.capturedTerritory);
      // Payment: within the cap, contingent budget first so the kicker stays
      // available for extra actions; beyond the cap, entirely bonus-funded.
      const drawn = beyondCap ? match.cost : Math.max(0, match.cost - remaining);
      if (drawn > 0) {
        bonusPool[match.type] -= drawn;
        pushLog(state, `${army} draws ${drawn} obelisk ${match.type} budget${beyondCap ? ' (extra action)' : ''}`);
      }
      remaining -= match.cost - drawn;
      taken++;
      if (checkElimination(state)) return state;
      // The other army may respond with obelisk abilities.
      offerReactions(state, other(army), engines, rng);
      if (state.phase !== 'play') return state;
    }
  }

  state.toMove = other(army);
  state.turn++;
  if (state.turn > config.maxTurns) {
    state.phase = 'over';
    const sA = armyStrengthOnBoard(state, 'A');
    const sB = armyStrengthOnBoard(state, 'B');
    let leader = sA > sB ? 'A' : sB > sA ? 'B' : null;
    let basis = `strength ${sA}·${sB}`;
    if (!leader && config.turnLimitTiebreak !== false) {
      // Strength dead even: controlled obelisks break the tie.
      const held = { A: 0, B: 0 };
      for (const ob of config.obelisks ?? []) {
        const c = obeliskStatus(state, ob).controller;
        if (c) held[c]++;
      }
      leader = held.A > held.B ? 'A' : held.B > held.A ? 'B' : null;
      basis += ` obelisks ${held.A}·${held.B}`;
    }
    if (config.turnLimitTiebreak !== false && leader) {
      state.winner = leader;
      state.reason = 'turn-limit-tiebreak';
      pushLog(state, `${leader} wins at turn limit ${config.maxTurns} (${basis})`);
    } else {
      state.winner = 'draw';
      state.reason = 'max-turns';
      pushLog(state, `draw: turn limit ${config.maxTurns} reached (${basis})`);
    }
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
