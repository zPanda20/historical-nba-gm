# Historical NBA GM — Alpha 0.1

Be the general manager of an NBA franchise from October 1976. Alpha 0.1 covers the 1976–77 season, the playoffs, the 1977 draft and free agency into 1977–78.

**Play:** https://zpanda20.github.io/historical-nba-gm/

## Controls
Arrow keys move the selection, Enter chooses. 1–8 jump between sections. Tab opens the most urgent call on your desk. Space looks up to the rafters. Esc closes things and opens the pause menu. F toggles full screen. The mouse works everywhere too.

## How it works
- A possession-by-possession engine tuned to 1976–77 league numbers. Watched games and fast sims run the same engine. Nothing is scripted.
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
Data pack: `public/data/world1976.json` (built by `tools/build_data.py`, then calibrated with `scripts/calibrate.ts`).

Unofficial, non-commercial fan prototype. Team, league and player names, logos and photos belong to their owners.
