# Architecture

Malzob is one Node process (HTTP + WebSocket) and a browser client. The server
holds the only authoritative copy of the table; clients send intents and
render whatever state the server broadcasts.

```
 browser A ─┐                    ┌───────────────── Node server ─────────────────┐
            │  intents (JSON)    │                                                │
            ├──────── /ws ──────►│  Table: parse → validate → reduce → save      │
 browser B ─┤                    │                   │           │     │         │
            │◄── state / users ──│◄──── broadcast ───┘           │   data/state.json
            │                    │                               │                │
            ├── POST /api/images►│  ImageStore ──────────────────┴─► data/images/ │
            └── GET  /, /images ►│  static files (build/public)                   │
                                 └────────────────────────────────────────────────┘
```

## Layers

### `src/shared/` — pure logic, no I/O

Imported by both sides; everything here is deterministic and unit-tested.

| file           | role |
|----------------|------|
| `types.ts`     | the data model: `TableState`, `TableMap`, `GridSettings`, `Token`, `TokenTemplate`, `StatSheet`, `ImageRef`, `User` |
| `grid.ts`      | grid maths: default grid, pixel ↔ cell, sub-cell snapping, clamping, keyboard steps, feet |
| `stats.ts`     | D&D 5e: ability modifiers, conditions list, default sheet, sheet patches |
| `protocol.ts`  | the WebSocket message types (see [protocol.md](protocol.md)) |
| `validate.ts`  | structural validation of incoming messages, with `LIMITS` |
| `reducer.ts`   | `applyIntent(state, intent, ctx)`: the only place where the state changes |
| `imageInfo.ts` | reads format and size of PNG/JPEG/WebP from bytes |
| `migrate.ts`   | `migrateState()`: fills in fields added after a state was saved |

The reducer never mutates its input and never generates ids or reads files
itself: ids and image lookups come from a `ReducerContext`. That keeps it
pure, so it can be tested in isolation and could later run on the client too
(optimistic updates, replay, undo).

### `src/server/` — Node

| file        | role |
|-------------|------|
| `main.ts`   | entry point for `npm start`; reads `PORT`, `HOST`, `DATA_DIR` |
| `app.ts`    | `startServer()`: wires HTTP, WebSocket, stores; used by main and tests |
| `table.ts`  | `Table`: connected clients, users, message handling, broadcast |
| `http.ts`   | static files, image upload and image download |
| `images.ts` | `ImageStore`: images on disk, named by sha256 |
| `store.ts`  | `StateStore`: debounced, atomic JSON persistence |

Message handling in `Table.receive`:

1. `JSON.parse` — failure → `error bad_json`
2. `validateClientMessage` — failure → `error invalid`
3. session messages (`hello`, `user.rename`) are handled directly
4. `ping` and `ruler` are ephemeral: relayed, never stored on disk (pings
   are rate-limited; the latest ruler of each client is kept in memory for
   newcomers)
5. everything else goes to `applyIntent`; a rejection (`not_found`) is sent
   back to the sender only
6. on success: replace the state, schedule a save, broadcast `state` to all

### `src/client/` — browser (Preact, SVG)

| file            | role |
|-----------------|------|
| `main.tsx`      | entry point; wires store, connection, controller, UI |
| `store.ts`      | `ClientState` (server state + local UI state) and a tiny observable store |
| `controller.ts` | the API the UI calls: `send`, `select`, `setView`, `upload`… and server-message handling |
| `connection.ts` | WebSocket with exponential-backoff reconnection; re-sends `hello` on each open |
| `view.ts`       | pan/zoom maths (local to each client) |
| `keyboard.ts`   | shortcuts: arrows move the selected token, Escape cancels / closes |
| `upload.ts`     | image upload over HTTP |
| `ui/App.tsx`    | layout, join form, user list |
| `ui/MapView.tsx`| the SVG map: background, grid, tokens, drag, pan, zoom, placing, ruler, grid calibration, pings |
| `ui/MapToolbar.tsx` | tool buttons over the map (select, ruler, ping) and the hint for the active tool (grid setup is started from the grid panel) |
| `ui/SizeSelect.tsx` | token size picker (presets with D&D size names, "map default") |
| `ui/MapsPanel.tsx`, `ui/TemplatesPanel.tsx`, `ui/StatSheet.tsx` | sidebar panels and the 5e sheet |
| `ui/fields.tsx` | inputs that commit on change and are not overwritten while focused |

The whole app re-renders on every store change (`render(<App/>)` is
synchronous), which keeps the UI simple and makes tests deterministic. Local
UI state (selection, pan/zoom, drag preview, active tool, ruler, grid
calibration in progress, pings being shown, collapsed sidebar) lives in the
client store, never on the server.

The map is SVG rather than `<canvas>` so that tests can inspect it: every
token is a `<g data-token-id=…>` whose transform reflects its cell.

## Data and persistence

- `data/state.json` — the whole `TableState`, written atomically
  (`state.json.tmp` then rename) at most every 200 ms and on shutdown. A
  corrupt file is moved aside (`state.json.corrupt-<time>`) and the server
  starts empty. On load, `migrateState` adds defaults for fields introduced
  by newer versions (e.g. `feetPerCell`, `subdivisions`, `defaultTokenSize`,
  and `cellSize` → `cellWidth`/`cellHeight`).

## Grid geometry

A map's grid is defined in image pixels: `cellWidth` × `cellHeight` (sub-pixel
allowed, not necessarily square), an origin offset (`offsetX`, `offsetY`),
`cols` × `rows` cells, and the distance a cell represents (`feetPerCell`, 5 by
default). `subdivisions` = n splits every cell into n × n sub-cells. Token
positions are stored in cells (`col`, `row`) and are multiples of `1 / n`, so
changing the cell size or offset never moves tokens relative to the grid.

Token sizes are in cells and may be fractional; `size: null` means "use the
map's `defaultTokenSize`" (`tokenSize()`). A token smaller than one step (a
sub-cell, or a cell when not split) occupies that step and is drawn centred
in it (`footprint()`, `tokenRect()`). All snapping goes through `clampToGrid`,
used both by the server (authoritative) and by the client (drag preview,
keyboard moves, placing).

"Set grid from 2 cells" (`gridFromCells()`): the user marks two cells, ideally
far apart, by clicking two opposite corners of each (four clicks). On each
axis, the four clicked edges are lines `k = 0, 1, n, n + 1` of the grid, where
`n` is the number of cells between the two marked cells (estimated from their
average size). A least-squares line through these four points gives the cell
size and the offset: click errors are divided by the distance between the
cells, so far-apart cells give a precise grid, and two very different cells
still give the best compromise. Width and height are fitted independently,
so non-square cells work. Columns and rows are then re-derived from the image.

The ruler (`rulerDistance()`) measures straight lines anywhere, converting
horizontal and vertical pixels with the cell width and height. Each client's
ruler is shared with the others through the ephemeral `ruler` message.
- `data/images/<sha256>.<ext>` — uploaded images, deduplicated by content.
- Connected users are not persisted.

The data directory is configurable with `DATA_DIR` and ignored by git.

## Design notes for future features

- **Roles and permissions (GM/player)**: `Table.handle` is the single choke
  point. Add a `role` to `User` and check it before `applyIntent`; the
  broadcast step is where per-user filtering (hidden tokens, GM notes) would go.
- **Fog of war, walls, lighting, drawings**: add arrays to `TableMap` (or
  `TableState`), new intents in `protocol.ts` + `validate.ts` + `reducer.ts`,
  and new SVG layers in `MapView` between the background and the tokens.
- **Initiative tracker, dice, chat**: new top-level state, or ephemeral
  messages relayed like `ping` (see `Table.handle`), and a new sidebar panel.
- **Measurement templates (cones, spheres…)**: same pattern as the shared
  ruler: an ephemeral message, drawn in a layer of `MapView`.
- **Bandwidth**: the server broadcasts the full state on each change. `rev`
  is already there to allow switching to patches later.
- **Accounts/passwords**: would sit in `app.ts` at the WebSocket upgrade and
  the HTTP upload route.
