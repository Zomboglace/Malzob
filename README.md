# Malzob

A minimal **virtual tabletop (VTT)** for Dungeons & Dragons 5e. A small Node
server keeps the table state and syncs every connected browser in real time:
open it in two browsers and you see the same maps, tokens and stat sheets.

It is meant as a **clean base to extend**: small files, plain TypeScript,
very few dependencies, and tests for every feature.

## Features

- **Maps**: several maps, one active map shown to everyone; a background image
  per map (PNG, JPEG or WebP, up to 15 MiB, stored on the server by content hash).
- **Grid**: cell width/height (non-square allowed) and X/Y offset with
  sub-pixel precision to align with the image, or **set it with two clicks** on
  opposite corners of one cell; columns/rows (derived from the image by
  default), line colour and opacity, show/hide, distance per cell (5 ft by
  default, editable). Cells can be split (2 × 2, 3 × 3, …) so tokens move by
  sub-cells.
- **Tokens**: place, drag or move with the arrow keys (snapped to the grid or
  its sub-cells and kept inside it), delete, duplicate, name, colour or image,
  HP bar. Size in cells, fractional sizes included (½ cell for Tiny…), either
  per token or from a default size set on each map.
- **Ruler** to measure any distance, anywhere, in feet and cells.
- **Ping**: show everyone a spot with an expanding, fading circle.
- **Templates** ("monster/character models"): a library of templates with a
  stat sheet. Placing a template creates a token with its own copy of the stats.
  Editing a token never changes its template; editing a template never changes
  tokens already placed.
- **D&D 5e stat sheet** for tokens and templates: AC, HP (current/max/temp),
  speed, the six abilities with automatic modifiers, proficiency and initiative
  bonuses, conditions, notes. Edits sync live.
- **Multi-user**: everyone picks a display name; connected users are listed;
  clients reconnect and resync automatically; state survives a server restart.
- **Local view**: pan (drag empty space or middle-button drag) and zoom (mouse
  wheel), per client. The sidebar can be hidden.

Not there yet (see [docs/architecture.md](docs/architecture.md) for how they
would fit): GM/player roles, fog of war, walls and line of sight, lighting,
drawing, initiative tracker, dice, chat, accounts.

## Requirements

- Node.js **22 or newer** (npm included)
- Nothing else: no database, no browser needed to install, build or test.

## Install

```sh
npm ci
```

All dependency versions are pinned and locked in `package-lock.json`.
`.npmrc` disables install scripts, so installing never downloads anything
besides the npm packages themselves.

## Start

```sh
npm start
```

This builds the client and starts the server on <http://localhost:3000>.
Open that URL in two browsers (or two tabs), choose a name in each, and play.

Environment variables:

| variable   | default  | meaning |
|------------|----------|---------|
| `PORT`     | `3000`   | HTTP/WebSocket port |
| `HOST`     | all interfaces | interface to bind, e.g. `127.0.0.1` |
| `DATA_DIR` | `./data` | where `state.json` and uploaded images are stored |

To play with friends on your network, share `http://<your-ip>:3000`. There is
no authentication: anyone who can reach the server can edit the table.

Quick tour: create a map in the left sidebar and upload a background image.
To align the grid, zoom in on the image, click **Set grid** and click two
opposite corners of one cell (fine-tune with the number fields if needed).
Add a template (e.g. "Goblin"), click **Place** then click on the map. Click a
token to open its stat sheet; drag it to move it.

Map tools (buttons over the map): **Select** (default), **Ruler** (drag to
measure), **Ping** (click to show a spot to everyone), **Set grid** (two clicks).

Keyboard:

| key | action |
|-----|--------|
| arrows | move the selected token by one step (one sub-cell when cells are split, otherwise one cell) |
| Shift + arrows | move the selected token by one full cell |
| Esc | leave the current tool, otherwise cancel placing, otherwise close the stat sheet |
| Shift + click (while placing) | place several tokens |
| Alt + click | ping, whatever the tool |
| middle-button drag | pan, whatever the tool |

Decimal fields (cell width/height, offsets, feet per cell) accept `70.5` or
`70,5`. Editing the width of square cells keeps them square; edit the height
afterwards for non-square cells.

## Test

```sh
npm run typecheck   # tsc, no emit
npm test            # builds, then runs every test with node:test
```

Pass extra arguments to the Node test runner after `--`, for example
`npm test -- --test-name-pattern="stat sheet"`.

Tests are headless: server tests start a real server on a free port in a
temporary directory and connect real WebSocket clients; UI tests render the
real Preact components in [happy-dom](https://github.com/capricorn86/happy-dom).

## Project structure

```
src/
  shared/    pure logic and types, no I/O (grid, stats, protocol, validation, reducer)
  server/    node:http + ws server: static files, image upload, authoritative state, persistence
  client/    browser app (Preact); the map is drawn in SVG
    ui/      components: App, MapView, MapsPanel, TemplatesPanel, StatSheet, fields
public/      index.html and style.css, copied to build/public
tests/
  shared/    unit tests of the pure logic
  server/    HTTP, sync between two clients, validation, persistence
  client/    UI (happy-dom), connection and reconnection, view maths
  helpers/   test server, WebSocket test client, DOM setup, fake images
scripts/     build.mjs (esbuild) and test.mjs (test runner)
docs/        architecture.md and protocol.md
```

## How to add a feature

Most features follow the same path. Example: a "visible to players" flag on tokens.

1. **Model** — add the field to the type in `src/shared/types.ts`
   (`Token.hidden: boolean`) and its default where objects are created in
   `src/shared/reducer.ts`.
2. **Protocol** — add or extend a message in `src/shared/protocol.ts`
   (here: `hidden?: boolean` in `AppearancePatch`).
3. **Validation** — accept and check it in `src/shared/validate.ts`.
   The server rejects anything not listed there.
4. **Reducer** — apply it in `src/shared/reducer.ts`. Keep it pure.
5. **UI** — render it and send the intent through `app.send(...)` from a
   component in `src/client/ui/`.
6. **Tests** — a reducer test in `tests/shared/`, a validation test, and a UI
   test in `tests/client/`; add a server test in `tests/server/` if it changes
   sync or persistence.
7. **Docs** — document the message in `docs/protocol.md`.

Existing saved states will not have the new field: give it a default in
`src/shared/migrate.ts` (and bump `PROTOCOL_VERSION` if the messages change).

Keep dependencies to a minimum; the project is designed to install in
restricted environments.

## Documentation

- [docs/architecture.md](docs/architecture.md): layers, data flow, persistence, where future features plug in
- [docs/protocol.md](docs/protocol.md): every WebSocket message, with an example, and the HTTP routes

## License

[MIT](LICENSE)
