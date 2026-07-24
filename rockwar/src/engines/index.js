import { makeRandomEngine } from './random.js';
import { makeGreedyEngine } from './greedy.js';

// Registry of available engines. Add new engines here and they show up in
// both the CLI simulator and the frontend.
export const engineFactories = {
  random: makeRandomEngine,
  greedy: makeGreedyEngine,
};

export function makeEngine(name, opts) {
  const f = engineFactories[name];
  if (!f) throw new Error(`unknown engine '${name}' (have: ${Object.keys(engineFactories).join(', ')})`);
  return f(opts);
}
