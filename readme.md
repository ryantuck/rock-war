# Rock War

Something like risk and chess and settlers and warhammer and go.

A two-player territory war on a 5×5 board, built as a sandbox for rapid
rules iteration: a pure-JS rules engine, three AI engines that play it, a
CLI simulator for batch-running hundreds of games per rules tweak, and an
animated browser frontend.

## Play / watch

```sh
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000
```

The frontend ([index.html](index.html)) animates games action-by-action
between any two engines, lets you edit the rules config live as JSON, and
batch-runs hundreds of games in-browser.

```sh
cd rockwar
node src/sim.js --games 500 --a lookahead --b greedy --seed 42
```

## Rules in brief

- **Armies**: 8×1 scouts, 5×2 warriors, 3×3 chieftains, 2×5 warlords, 1×8
  behemoth — fibonacci counts of fibonacci values, 45 points per side. Two
  scouts each start on the board (snake placement); the rest deploy by
  spawning and evolving.
- **Territories** hold at most 2 pieces, which must be fibonacci-adjacent:
  (1,1) (1,2) (2,3) (3,5) (5,8).
- **Contingents**: contiguous groups of one army's territories act as units.
  Each takes up to 2 actions per turn, with fibonacci-valued costs summing
  to at most the contingent's strength.
- **Actions**: *spawn* a scout (1) · *move* (cost = value difference, scouts
  always 1) · *evolve* a pair into its fibonacci sum (1+2→3, 2+3→5, 3+5→8)
  · *attack* an adjacent enemy territory (cost = attacker's value; scouts
  can't attack; attacker must be ≥ the territory's total).
- **Combat**: defenders retreat free into adjacent friendly territories or
  die; breaking a defense worth more than half the attacker's value makes
  the attacker **devolve** into its fibonacci constituents (3→2+1, 5→3+2,
  8→5+3) as it advances — value is conserved, concentration is the price.
- **Obelisks**: four elemental obelisks on corner intersections (fire→attack,
  earth→evolve, air→move, water→spawn). Occupying ≥2 adjacent territories
  with the greatest adjacent value ≥3 grants bonus budget for that mechanic
  (fibonacci-scaled, can fund extra actions past the cap) and a once-per-turn
  active ability — castable on either player's turn, fueled by an
  obelisk-adjacent scout.
- **Winning**: eliminate the enemy's board pieces or leave them unable to
  act.

Full rules, every tunable knob, engine internals, and simulation findings:
[rockwar/README.md](rockwar/README.md).

## Engines

- **random** — uniform legal choices; the baseline.
- **greedy** — one-shot weighted scoring of every legal action.
- **lookahead** — one-ply search: applies each candidate through the real
  rules engine and evaluates the resulting position.

## Older prototypes

`game.py`, `engine.py`, and friends at the repo root are earlier Python
prototypes (`make` to run); the current game lives in `rockwar/`.
