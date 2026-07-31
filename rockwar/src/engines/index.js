import { makeRandomEngine } from './random.js';
import { makeGreedyEngine } from './greedy.js';
import { makeLookaheadEngine, makePlannerEngine } from './lookahead.js';

// Strategy-archetype presets: the same lookahead search with re-weighted
// evaluators. Tournaments between these measure which strategies the
// CURRENT rules favor — a balance instrument, not just opponents.
const preset = (name, overrides) => (opts = {}) => {
  const e = makeLookaheadEngine({ ...overrides, ...opts });
  e.name = name;
  return e;
};

// Registry of available engines. Add new engines here and they show up in
// both the CLI simulator and the frontend.
export const engineFactories = {
  random: makeRandomEngine,
  greedy: makeGreedyEngine,
  lookahead: makeLookaheadEngine,
  // Full-turn beam search over action sequences (depth 3, beam 6).
  planner: makePlannerEngine,
  // Planner search with the map-control evaluator — depth plus strategy.
  'planner-obelisk': (opts = {}) => {
    const e = makePlannerEngine({
      obeliskHold: 9, obeliskProgress: 1.2, obeliskFoothold: 4, obeliskCount: 10,
      obeliskFadeAt: 6, advance: 0.8, myThreat: 4, ...opts,
    });
    e.name = 'planner-obelisk';
    return e;
  },
  // Wins by attrition: hunts kills, shrugs at obelisks.
  'lookahead-aggro': preset('lookahead-aggro', {
    fighting: 6, threat: 2, myThreat: 9, advance: 2.5, hunt: 4, huntCap: 6,
    obeliskHold: 2, obeliskProgress: 0.2, obeliskFoothold: 1, obeliskCount: 2,
  }),
  // Plays the map: corner control, the 3-obelisk race, ability leverage.
  'lookahead-obelisk': preset('lookahead-obelisk', {
    obeliskHold: 9, obeliskProgress: 1.2, obeliskFoothold: 4, obeliskCount: 10,
    obeliskFadeAt: 6, advance: 0.8, myThreat: 4,
  }),
  // Plays not to lose: material first, tiebreak-lead clock game.
  'lookahead-turtle': preset('lookahead-turtle', {
    material: 12, threat: 6, myThreat: 3, advance: 0.6, hunt: 1, huntCap: 2,
    obeliskHold: 6, costPenalty: 0.5, passMargin: -1,
  }),
  // Plays the economy: development, evolve chains, board presence.
  'lookahead-tempo': preset('lookahead-tempo', {
    pieces: 4, fighting: 5, potential: 4, advance: 1.0, myThreat: 4,
    spawnTempo: 3, costPenalty: 0.2,
  }),
};

export function makeEngine(name, opts) {
  const f = engineFactories[name];
  if (!f) throw new Error(`unknown engine '${name}' (have: ${Object.keys(engineFactories).join(', ')})`);
  return f(opts);
}
