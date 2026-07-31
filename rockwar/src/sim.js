#!/usr/bin/env node
// Batch simulator: play many games between two engines and report stats.
//
//   node src/sim.js --games 500 --a greedy --b random --seed 42
//   node src/sim.js --games 200 --a greedy --b greedy --config my-rules.json
//
// Seats are swapped every game (unless --no-swap) so first-mover advantage
// doesn't pollute engine comparisons; results are reported per engine AND
// per seat so you can measure that advantage while iterating on rules.

import { readFileSync } from 'node:fs';
import { playGame, defaultConfig, armyStrengthOnBoard } from './game.js';
import { makeEngine, engineFactories } from './engines/index.js';
import { mulberry32 } from './rng.js';

// Round-robin tournament: every pair of engines plays N games (seats
// swapped); standings by points (win 1, draw 0.5) plus a head-to-head grid.
function runTournament(names, gamesPer, seed, config) {
  const stats = Object.fromEntries(names.map((n) => [n, { w: 0, l: 0, d: 0 }]));
  const h2h = Object.fromEntries(names.map((n) => [n, {}]));
  const t0 = Date.now();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [n1, n2] = [names[i], names[j]];
      const e1 = makeEngine(n1);
      const e2 = makeEngine(n2);
      let w1 = 0, w2 = 0, dd = 0;
      for (let g = 0; g < gamesPer; g++) {
        const swapped = g % 2 === 1;
        const engines = swapped ? { A: e2, B: e1 } : { A: e1, B: e2 };
        const final = playGame({ engines, config: structuredClone(config), rng: mulberry32(seed + i * 1e6 + j * 1013 + g * 7919) });
        if (final.winner === 'draw') dd++;
        else if ((final.winner === 'A') === !swapped) w1++;
        else w2++;
      }
      stats[n1].w += w1; stats[n1].l += w2; stats[n1].d += dd;
      stats[n2].w += w2; stats[n2].l += w1; stats[n2].d += dd;
      h2h[n1][n2] = (w1 + dd / 2) / gamesPer;
      h2h[n2][n1] = (w2 + dd / 2) / gamesPer;
      process.stderr.write(`  ${n1} vs ${n2}: ${w1}-${w2}-${dd}\n`);
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const rows = names
    .map((n) => {
      const s = stats[n];
      const games = s.w + s.l + s.d;
      return { n, ...s, pts: games ? (100 * (s.w + s.d / 2)) / games : 0 };
    })
    .sort((x, y) => y.pts - x.pts);
  console.log(`\nTournament: ${names.length} engines, ${gamesPer} games per pairing (seed ${seed}, ${elapsed}s)`);
  console.log('─'.repeat(64));
  rows.forEach((r, k) => {
    console.log(`  ${String(k + 1).padStart(2)}. ${r.n.padEnd(20)} ${r.pts.toFixed(1).padStart(5)}%   ${String(r.w).padStart(4)}W ${String(r.l).padStart(4)}L ${String(r.d).padStart(4)}D`);
  });
  const short = (n) => n.replace('lookahead', 'la').slice(0, 9);
  console.log(`\n  head-to-head points% (row vs column):`);
  console.log(`  ${''.padEnd(10)}${rows.map((r) => short(r.n).padStart(10)).join('')}`);
  for (const r of rows) {
    console.log(`  ${short(r.n).padEnd(10)}${rows.map((c) => (c.n === r.n ? '—'.padStart(10) : (100 * h2h[r.n][c.n]).toFixed(0).padStart(9) + '%')).join('')}`);
  }
}

function parseArgs(argv) {
  const args = { games: 100, a: 'greedy', b: 'random', seed: 1, swap: true, config: null, verbose: false, tournament: false, engines: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') args.games = parseInt(argv[++i], 10);
    else if (k === '--a') args.a = argv[++i];
    else if (k === '--b') args.b = argv[++i];
    else if (k === '--seed') args.seed = parseInt(argv[++i], 10);
    else if (k === '--no-swap') args.swap = false;
    else if (k === '--config') args.config = argv[++i];
    else if (k === '--verbose') args.verbose = true;
    else if (k === '--tournament') args.tournament = true;
    else if (k === '--engines') args.engines = argv[++i].split(',');
    else if (k === '--help' || k === '-h') {
      console.log('usage: node src/sim.js [--games N] [--a engine] [--b engine] [--seed S] [--no-swap] [--config file.json] [--verbose]');
      console.log('       node src/sim.js --tournament [--engines a,b,c] [--games N-per-pairing] [--seed S] [--config file.json]');
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
let config = defaultConfig();
if (args.config) config = { ...config, ...JSON.parse(readFileSync(args.config, 'utf8')) };

if (args.tournament) {
  const names = args.engines ?? Object.keys(engineFactories);
  runTournament(names, args.games, args.seed, config);
  process.exit(0);
}

const engine1 = makeEngine(args.a);
const engine2 = makeEngine(args.b);
const name1 = args.a === args.b ? `${args.a}#1` : args.a;
const name2 = args.a === args.b ? `${args.b}#2` : args.b;

const stats = {
  wins: { [name1]: 0, [name2]: 0, draw: 0 },
  seatWins: { A: 0, B: 0 },
  reasons: {},
  turns: [],
  winnerSurvivingStrength: [],
};

const t0 = Date.now();
for (let g = 0; g < args.games; g++) {
  const swapped = args.swap && g % 2 === 1;
  const engines = swapped ? { A: engine2, B: engine1 } : { A: engine1, B: engine2 };
  const names = swapped ? { A: name2, B: name1 } : { A: name1, B: name2 };
  const rng = mulberry32(args.seed + g * 7919);

  const final = playGame({ engines, config: structuredClone(config), rng });

  stats.turns.push(final.turn);
  stats.reasons[final.reason] = (stats.reasons[final.reason] || 0) + 1;
  if (final.winner === 'draw') {
    stats.wins.draw++;
  } else {
    stats.wins[names[final.winner]]++;
    stats.seatWins[final.winner]++;
    stats.winnerSurvivingStrength.push(armyStrengthOnBoard(final, final.winner));
  }
  if (args.verbose) {
    console.log(`game ${g + 1}: winner=${final.winner === 'draw' ? 'draw' : names[final.winner]} (seat ${final.winner}) reason=${final.reason} turns=${final.turn}`);
  }
}
const elapsed = (Date.now() - t0) / 1000;

const avg = (xs) => (xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : '-');
const pct = (n) => ((100 * n) / args.games).toFixed(1) + '%';

console.log(`\n${args.games} games: ${name1} vs ${name2}  (seed ${args.seed}, seats ${args.swap ? 'swapped each game' : 'fixed'}, ${elapsed.toFixed(2)}s)`);
console.log('─'.repeat(60));
console.log(`  ${name1.padEnd(12)} ${String(stats.wins[name1]).padStart(5)}  ${pct(stats.wins[name1])}`);
console.log(`  ${name2.padEnd(12)} ${String(stats.wins[name2]).padStart(5)}  ${pct(stats.wins[name2])}`);
console.log(`  ${'draws'.padEnd(12)} ${String(stats.wins.draw).padStart(5)}  ${pct(stats.wins.draw)}`);
console.log(`  seat A wins ${stats.seatWins.A}, seat B wins ${stats.seatWins.B} (first-mover check)`);
const totalSupply = Object.entries(config.supply).reduce((s, [v, n]) => s + Number(v) * n, 0);
console.log(`  avg game length: ${avg(stats.turns)} turns`);
console.log(`  avg winner surviving strength: ${avg(stats.winnerSurvivingStrength)} / ${totalSupply}`);
console.log(`  endings: ${Object.entries(stats.reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);
