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
4. `ping` is ephemeral: relayed to everyone, never stored (rate-limited)
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
| `ui/MapToolbar.tsx` | tool buttons over the map (select, ruler, ping, set grid) and the hint for the active tool |
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

"Set grid" (`gridFromCorners()`) turns two clicks on opposite corners of one
cell into `cellWidth`, `cellHeight` and an offset that puts grid lines on the
clicked corners; columns and rows are then re-derived from the image. The
ruler (`rulerDistance()`) measures straight lines anywhere, converting
horizontal and vertical pixels with the cell width and height.
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
- **Shared ruler / measurement templates**: the ruler is local today; sharing
  it would be an ephemeral message like `ping`.
- **Bandwidth**: the server broadcasts the full state on each change. `rev`
  is already there to allow switching to patches later.
- **Accounts/passwords**: would sit in `app.ts` at the WebSocket upgrade and
  the HTTP upload route.
