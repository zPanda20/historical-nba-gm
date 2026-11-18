# Historical NBA GM — Alpha 0.5

Be the general manager of an NBA franchise from October 1976 and keep going to 2040. Every season works end to end: the real league calendar (relocations, renames, new logos, expansion, realignment, lockout seasons), era playoff formats (12-team byes, 16 teams, play-in), era draft lotteries, real draft classes 1977–2026 and generated classes after that.

**Play:** https://zpanda20.github.io/historical-nba-gm/

## Controls
Arrow keys move the selection, Enter chooses. 1–8 jump between sections. Tab opens the most urgent call on your desk. Space looks up to the rafters. Esc closes things and opens the pause menu. F toggles full screen. The mouse works everywhere too.

## How it works
- A possession-by-possession engine tuned to era league numbers (pace, three-point volume and accuracy, scoring) from 1976–77 to 2025–26; after 2026 the league drifts toward one of four seeded futures.
- Positions matter: the coach builds a depth chart, every player on the floor holds a spot, and odd lineups (three centres, no ball-handler, no shooters) cost you on both ends — less so for a coach with a real plan. Watched games and fast sims run the same engine. Nothing is scripted.
- The coach runs lineups and rotations; you make requests, trades, signings, draft picks and set the franchise clock.
- Scouting shows ranges, never hindsight. Salaries before the save starts are reconstructed estimates. Personalities are simulated ("in this universe").
- Saves live in your browser (IndexedDB) and can be exported from the pause menu.

## Develop
```
npm install
npm run dev        # local game
npm run sim        # headless season for tuning
npm run build
```
Data pack: `public/data/world1976.json` (built by `tools/build_data.py`, then calibrated with `scripts/calibrate.ts`). Draft classes: `public/data/classes.json` (built by `tools/build_classes.py`, era-normalised ratings). League history and era rules: `src/sim/history.ts`.

`npx tsx scripts/longrun.ts <seed> 2040` plays 1976→2040 headless and prints era stats, champions, drafts and franchise moves.

Unofficial, non-commercial fan prototype. Team, league and player names, logos and photos belong to their owners.
