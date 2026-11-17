# Malzob

A minimal **virtual tabletop (VTT)** for Dungeons & Dragons 5e. A small Node
server keeps the table state and syncs every connected browser in real time:
open it in two browsers and you see the same maps, tokens and stat sheets.

It is meant as a **clean base to extend**: small files, plain TypeScript,
very few dependencies, and tests for every feature.

## Features

- **Maps**: several maps; the owner looks at any of them, and sends each
  player to a map individually (players start on the default map, chosen
  with ★); a background image
  per map (PNG, JPEG or WebP, up to 15 MiB, stored on the server by content hash).
- **Grid**: cell width/height (non-square allowed) and X/Y offset with
  sub-pixel precision to align with the image, or **set it by marking two
  cells** far apart (four clicks; the grid is fitted to both); columns/rows (derived from the image by
  default), line colour and opacity, show/hide, distance per cell (5 ft by
  default, editable). Cells can be split (2 × 2, 3 × 3, …) so tokens move by
  sub-cells.
- **Tokens**: place, drag or move with the arrow keys (snapped to the grid or
  its sub-cells and kept inside it), delete, duplicate, name, colour or image,
  HP bar. Size in cells, fractional sizes included (½ cell for Tiny…), either
  per token or from a default size set on each map.
- **Ruler** to measure any distance, anywhere, in feet and cells; everyone
  sees it live.
- **Ping**: show everyone a spot with an expanding, fading circle.
- **Templates** ("monster/character models"): a library of templates with a
  stat sheet. Placing a template creates a token with its own copy of the stats.
  Editing a token never changes its template, and editing a template never
  changes tokens already placed, unless the template is marked **unique**:
  then the template and all its tokens, on every map, are linked and share
  every change (positions excepted). Handy for named characters.
- **D&D 5e stat sheet** for tokens and templates: AC, HP (current/max/temp),
  speed, the six abilities with automatic modifiers, proficiency and initiative
  bonuses, conditions, notes. Edits sync live.
- **Owner and players**: the owner (game master) logs in with a username and
  password and configures everything. Players join with just a name; they can
  use the ruler and pings, and move and edit the tokens the owner gives them
  (see [Owner and players](#owner-and-players)).
- **Multi-user**: connected users are listed; clients reconnect and resync
  automatically; state survives a server restart.
- **Local view**: pan (drag empty space or middle-button drag) and zoom (mouse
  wheel), per client. The owner can hide the sidebar (☰ button, top left).

Not there yet (see [docs/architecture.md](docs/architecture.md) for how they
would fit): fog of war, walls and line of sight, lighting, drawing,
initiative tracker, dice, chat.

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

**The first time**, it asks in the terminal for the **owner username and
password** (the game master's account; the password is not shown while you
type; any length, but not empty). It is stored hashed in
`data/owner.json`. Then open the URL: log in with the owner username and
password; players open the same URL and type just a name.

To change the owner username or password (for example if you forgot it):

```sh
npm run reset
```

It asks for new owner credentials and stops; maps and tokens are kept, and
browsers logged in as the owner are signed out. Start again with `npm start`.

Environment variables:

| variable   | default  | meaning |
|------------|----------|---------|
| `PORT`     | `3000`   | HTTP/WebSocket port |
| `HOST`     | all interfaces | interface to bind, e.g. `127.0.0.1` |
| `DATA_DIR` | `./data` | where `state.json`, `owner.json` and uploaded images are stored |
| `MALZOB_OWNER_USERNAME`, `MALZOB_OWNER_PASSWORD` | — | owner credentials to use instead of asking, when setting up or resetting without a terminal |

To play with friends on your network, share `http://<your-ip>:3000`. The
connection is plain HTTP: on an untrusted network, put the server behind an
HTTPS reverse proxy so the owner password is not sent in clear.

Quick tour (as the owner): create a map in the left sidebar and upload a background image.
To align the grid, click **Set grid from 2 cells** in the grid settings, then
click two opposite corners of a cell near one edge of the map and two
opposite corners of a cell far from it (ideally in the opposite corner). Zoom
in for precision; you can pan between clicks. Fine-tune with the number
fields (their arrows and the up/down keys change values by 1) if needed.
Add a template (e.g. "Goblin"), click **Place** then click on the map. Click a
token to open its stat sheet; drag it to move it. In the sheet, **Who can use
it** gives a token to players.

Map tools (buttons over the map): **Select** (default), **Ruler** (drag to
measure; shown to everyone), **Ping** (click to show a spot to everyone).

Keyboard:

| key | action |
|-----|--------|
| arrows | move the selected token by one step (one sub-cell when cells are split, otherwise one cell) |
| Shift + arrows | move the selected token by one full cell |
| Esc | leave the current tool, otherwise cancel placing, otherwise close the stat sheet |
| Shift + click (while placing) | place several tokens |
| Alt + click | ping, whatever the tool |
| middle-button drag | pan, whatever the tool |

Decimal fields (cell width/height, offsets, feet per cell) accept decimals
such as `70.5` (or `70,5` where the browser's language uses a decimal comma).
Editing the width of square cells keeps them square; edit the height
afterwards for non-square cells.

## Owner and players

| | owner (game master) | player |
|---|---|---|
| joins with | the owner username **and** password | any other name, no password |
| sidebar (maps, grid, templates) | yes | no |
| which map is shown | looks at any map (click it in the list), without moving the players | starts on the default map; then sees the map the owner sent them to |
| ruler, ping | yes | yes |
| tokens | everything | moves and edits the tokens given to them; cannot create, delete, duplicate them or save them as templates |
| HP and stat sheets | all tokens | only the tokens they control |

To move players between maps, use the **Players** panel in the sidebar
(one map per player; players who are offline keep their map for when they
come back), or **Bring all players here** to send everyone to the map you are
looking at. New players start on the default map, marked ★ in the map list:
click the ☆ of another map to make it the default. If the default map is
deleted, the first map of the list becomes the default.

To give a token to players, open its sheet (or a template's sheet, so that
every token placed from it is given too) and use **Who can use it**: click a
connected player, type a name, or tick **Any player**. Players are recognised
by their display name (not case-sensitive), so a player keeps their tokens
when they come back with the same name. The owner's username is reserved:
nobody can join with it without the password.

The server enforces all of this; players never receive the maps they cannot
see, the templates, or the stats of tokens they do not control.

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
