# Vital-Link

A health monitor for astronauts, gamified as a Tamagotchi: the companion's stats mirror the crew member's own.

## Run

Requires Node 20+ (the nvm default v18 is too old for Vite 8).

```sh
npm install
npm run dev        # open the printed localhost URL
npm run build      # production build in dist/
```

## Pages

| URL | Page |
|---|---|
| `/` | **Dashboard**: Main, Spacewalk and History views, tasks, and a debug menu (`` ` `` key) to change live values |
| `/displays.html` | **Display Kit**: every health measurement drawn with five reusable components |

## Layout

```
index.html, src/dashboard/   the dashboard
displays.html, src/displays/ the display kit (components.js is shared by both pages)
experiments/game/            the earlier 3D low-poly game, kept out of the build (see its README)
```
