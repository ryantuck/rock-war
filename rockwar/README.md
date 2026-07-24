# Rock War (v2 sandbox)

A self-contained implementation of the board game with two AI engines, a CLI
batch simulator, and a browser frontend — built for iterating on rules fast.
No dependencies, no build step; the same ES modules run in Node and the browser.

## Run it

```sh
cd rockwar

# Batch-simulate games from the CLI
node src/sim.js --games 500 --a greedy --b random --seed 42
node src/sim.js --games 500 --a greedy --b greedy
node src/sim.js --games 100 --a greedy --b random --verbose   # per-game lines
node src/sim.js --games 500 --a greedy --b random --config my-rules.json

# Frontend (ES modules need a server; any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

The frontend lets you watch games turn-by-turn or auto-play, edit the rules
config as JSON (applies on New game), and run batches of hundreds of games
in-browser with the same stats as the CLI.

## Rules as implemented

- **Board**: 4×4 grid of 16 territories, orthogonal adjacency.
- **Armies**: each side's sideboard holds 5×1 (scouts), 3×2 (warriors),
  2×3 (chieftains), 1×5 (warlord) — 22 points total.
- **Placement**: snake order (A B B A), one scout per slot onto any empty
  territory, until each army has placed `initialScouts` (default 2). Remaining
  sideboard pieces — including the other scouts — enter play by spawning and
  evolving. Then A moves first.
- **Territories** hold at most 2 pieces, which must be fibonacci-adjacent:
  (1,1), (1,2), (2,3), (3,5), (5,8).
- **Contingents**: a maximal contiguous group of one army's territories.
  Its strength is the sum of its piece values.
- **Turns**: on your turn, each of your contingents (snapshotted at turn start)
  takes up to 2 actions whose fibonacci-valued costs sum to at most the
  contingent's strength. Territories a contingent captures or moves into
  mid-turn count as part of it for its remaining action.
- **Actions**:
  - *Spawn* (cost 1): place a scout from the sideboard into one of the
    contingent's territories.
  - *Move* (cost = |mover − occupant|, empty counts as 0, scouts always cost 1):
    move a piece to an adjacent empty or friendly territory, respecting the
    2-piece / fib-adjacency limits. Example: a 3 into open territory costs 3; a
    3 onto a friendly 2 costs 1.
  - *Evolve* (cost = smaller constituent, configurable): combine the two
    co-located pieces into their fibonacci sum (1+1→2, 1+2→3, 2+3→5). Both
    constituents return to the sideboard; the new piece must be available there.
  - *Attack* (cost = attacking piece's value): strike an adjacent enemy
    territory with one piece.
- **Combat**: the defender may retreat each piece for free into an adjacent
  territory it occupies (respecting stacking limits), plus up to 1 scout per
  attack may retreat into an adjacent *empty* territory. Pieces that remain are
  destroyed (removed from the game) if the attacking piece's value ≥ their
  combined value; otherwise the attack is repelled with no effect (cost still
  paid). If the territory ends up empty — by retreat or destruction — the
  attacking piece advances into it.
- **Winning**: eliminate all enemy pieces from the board, or leave the enemy
  with no legal action on their turn. Games hit a draw at the turn limit.

## Assumptions made where the spec was open (all tunable)

The point of this sandbox is rule iteration, so every judgment call is a knob
in `defaultConfig()` (`src/game.js`) — editable live in the frontend's config
box or via `--config file.json` on the CLI:

| Knob | Default | The call that was made |
|---|---|---|
| `maxActionsPerContingent` | 2 | "two types of actions" read as *at most two actions per contingent per turn* |
| budget | ≤ strength | action costs sum *up to* strength (exact sums are usually impossible with 2 fib values) |
| `evolveCost` | `'smaller'` | evolve's cost wasn't specified; also supports `'larger'` and `'result'` |
| `scoutRetreatBudget` | 1 | read as *1 scout per attack* may flee to an empty territory |
| combat resolution | ≥ total | attacker destroys non-retreated defenders iff its piece value ≥ their sum, else repelled |
| destroyed pieces | removed | destroyed pieces leave the game entirely (they do *not* return to the sideboard) |
| capture on attack | yes | if the defended territory empties out, the attacker advances into it |
| `initialScouts` | 2 | scouts each army places in the placement phase (capped at scout supply) |
| `maxTurns` | 200 | draw backstop so batch runs always terminate |
| `supply` | 5/3/2/1 | change piece mix freely; placement uses the scout count |

## Engines

- **random** — uniform random legal choices; the baseline sanity check.
- **greedy** — scores every legal action with material/tempo/position weights
  (kills ≫ evolves > advancing > spawning) and retreats only when standing
  would lose pieces. Weights are overridable via the factory in
  `src/engines/greedy.js`.

Add an engine by implementing three functions and registering it in
`src/engines/index.js`:

```js
{
  placeScout(state, army, rng) -> territory index
  chooseAction(state, ctx, legalActions, rng) -> one of legalActions | null (pass)
  planRetreats(state, attackInfo, options, rng) -> [{ piece, dest }, ...]
}
```

Engines only ever pick from engine-generated legal-action lists, so a buggy
engine can't corrupt game state.

## Current observations (seed 42, 500 games, seats swapped)

- greedy beats random ~98%.
- greedy mirror: ~12% draws, and a *large* first-mover advantage — with only
  2 initial scouts, seat A won 391 of 440 decided games. The opening tempo
  (first spawn/evolve) dominates; a prime target for rule iteration.
- random mirror games run long (~81 turns avg) but still mostly end in
  elimination, so the rules don't deadlock on their own.
