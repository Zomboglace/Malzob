# Spec, part 1 of 3: walls and doors

Tests: `tests/upcoming/1-walls/` — run with **`npm run test:walls`** (type-checks
that folder, then runs it). Parts 2 (light) and 3 (vision, fog of war) build on
this one.

## Goal

The owner draws walls on a map, at any precision (not only on the grid or on
the active cell split). Walls block token movement; doors are walls the owner
opens and closes; see-through walls block movement but not sight (sight
matters from part 2 on). Players never receive walls or doors.

## Data model (`src/shared/types.ts`)

```ts
export type WallKind = "wall" | "seeThrough" | "door";

export interface Wall {
  id: string;
  mapId: string;
  /** End points, in cells (fractional), clamped into the map's grid. */
  from: { col: number; row: number };
  to: { col: number; row: number };
  kind: WallKind;
  /** Doors only (always false for other kinds): an open door blocks nothing. */
  open: boolean;
}

// TableState gains:
walls: Wall[];
```

- `emptyState()` has `walls: []`; `migrateState()` adds `walls: []` to older saves.
- Deleting a map deletes its walls.
- Update the shared test fixture `sampleTable()` in `tests/helpers/ui.ts` with
  `walls: []` (and any existing test that builds a `TableState` by hand).

## Shared logic (`src/shared/walls.ts`)

All coordinates are in cells (`{ col, row }`), like token positions.

| export | behaviour |
|---|---|
| `MOVE_TOLERANCE = 0.1` | leniency, in cells (see `canMove`) |
| `MAX_WALL_PRECISION = 10` | finest wall precision |
| `snapWallPoint(p, precision)` | rounds each coordinate to the nearest multiple of `1 / precision` (precision 1–10), then to 6 decimals (`Number(v.toFixed(6))`) |
| `blocksMovement(w)` | true for `wall`, `seeThrough`, and closed `door`; false for an open door |
| `blocksSight(w)` | true for `wall` and closed `door`; false for `seeThrough` and an open door |
| `lineBlocked(from, to, walls, blocks = blocksSight)` | true if the **open** segment from→to (its two end points excluded) intersects (crosses, touches, or overlaps collinearly) a wall `w` for which `blocks(w)` is true. A point lying exactly on a wall is therefore never hidden by that wall |
| `canMove(from, to, size, walls, tolerance = MOVE_TOLERANCE)` | can a token of `size` cells move in a straight line from top-left position `from` to `to`? See below |
| `wallAt(p, walls, maxDistance)` | the wall whose segment is nearest to point `p`, if its distance is ≤ `maxDistance` cells; otherwise `null` |
| `isMoveBlocked(state, user, intent)` | for a `token.move` intent: should the server refuse it? See *Movement rules* |

### `canMove`

- The token is the square `[col, col + size] × [row, row + size]`, shrunk on
  each side by `t = min(tolerance, size / 4)`.
- The area swept by a straight move is the convex hull of the shrunk square at
  `from` and the shrunk square at `to`.
- The move is refused if any wall with `blocksMovement(w)` intersects that
  hull (closed: touching counts).
- Exception, so that a token is never trapped: walls that already intersect
  the shrunk square at `from` are ignored.
- `from` equal to `to` is always allowed.

Examples on a grid of 1-cell squares, `MOVE_TOLERANCE` 0.1:
- A wall on the grid line `col = 5` blocks a 1×1 token at col 4 from moving to
  col 5, but not a token moving from col 3 to col 4 (its square stops at 4.9).
- A horizontal wall line with a 1-cell gap between cols 4 and 5 lets a 1×1
  token through, not a 2×2 one.
- Leniency: a gap from 4.05 to 4.95 (0.9 cell) still lets a 1×1 token at
  col 4 through (its square is 4.1–4.9); a gap starting at 4.2 does not.

### Movement rules (`isMoveBlocked`)

`token.move` gains an optional field **`via: "drag" | "keyboard"`** (missing
means `"keyboard"`). The target position is first snapped and clamped as today
(`clampToGrid`), then:

- the owner moving with `via: "drag"` ignores walls (they can always put a
  token anywhere);
- every other move (owner with the keyboard, players with drag or keyboard) is
  checked with `canMove(current position, target, token size, walls of the
  token's map)`; a refused move returns `true`.

The server refuses blocked moves with the new error code **`"blocked"`**
(`ErrorCode` gains `"blocked"`), and the state does not change.

## Protocol (version 8)

New client messages, **owner only** (players get `forbidden`):

```json
{ "type": "wall.create", "mapId": "m1", "from": { "col": 2, "row": 3.25 }, "to": { "col": 6.5, "row": 3.25 }, "kind": "wall" }
{ "type": "wall.update", "wallId": "w1", "changes": { "from": { "col": 1, "row": 1 }, "to": { "col": 2, "row": 1 }, "kind": "door" } }
{ "type": "wall.delete", "wallId": "w1" }
{ "type": "door.setOpen", "wallId": "w1", "open": true }
```

- `kind` is optional on `wall.create` (default `"wall"`); `changes` fields are
  all optional. Coordinates: finite numbers within ±100000; unknown fields are
  rejected (`invalid`) as for every message.
- The reducer clamps end points into `[0, cols] × [0, rows]` of the map and
  rounds them to 6 decimals; a wall whose two end points are equal (after
  clamping) is refused with `invalid`.
- Changing a door to another kind sets `open` to `false`.
- `door.setOpen` on a wall that is not a door is refused with `invalid`.
- `token.move` accepts `via` (see above).
- Players: `viewFor()` sends `walls: []`.

## Client

### Walls tool (owner only)

- The map toolbar gets a **Walls** button (`.tool-walls`, tool `"walls"`),
  shown to the owner only.
- While the tool is active, `[data-testid=wall-options]` shows:
  - `select[name=wallKind]`: `wall`, `seeThrough`, `door`;
  - `select[name=wallPrecision]`: `1`…`10`; defaults to the viewed map's
    `subdivisions`;
  - `select[name=wallMode]`: `draw`, `erase`.
- Draw mode: a click (press and release without moving; dragging still pans)
  sets a point: map pixels → cells (`(x - offsetX) / cellWidth`, same for y),
  then `snapWallPoint(…, precision)`. The first click starts a chain; each
  next click sends `wall.create` from the previous point to the new one, and
  the new point continues the chain. Clicking the same point again sends
  nothing. While a chain is started, `line.wall-preview` follows the pointer.
- **Escape** ends the current chain (tool still active); Escape with no chain
  leaves the tool, as for the other tools.
- Erase mode: a click deletes the wall `wallAt(point, walls of the map, 0.25)`
  (`wall.delete`), if any.

### Doors

With the **Select** tool, the owner clicking (press and release without
moving) within 0.25 cells of a door, and not on a token, sends
`door.setOpen` with the opposite of its `open`.

### Rendering (owner only — players have no wall data)

Inside the map's viewport, a `g.walls` group contains one
`line.wall[data-wall-id]` per wall of the viewed map, from
`(offsetX + from.col × cellWidth, offsetY + from.row × cellHeight)` to the
same for `to`, with the class `wall-wall`, `wall-seeThrough` or `wall-door`,
and `is-open` for open doors.

### Moving tokens

- Drag sends `token.move` with `via: "drag"`, keyboard moves with
  `via: "keyboard"`.
- Before sending, the client calls `isMoveBlocked(table, me, intent)` and does
  not send a blocked move. In practice this concerns the owner's arrow keys
  (a blocked arrow key moves nothing): the owner's drags ignore walls, and
  players have no wall data, so for them the server decides.
- When the server answers a `token.move` with the error code `blocked`, the
  client shows **no notice** (it is not a mistake, just a wall) and puts the
  token being dragged back at its position from the last state received
  (`store.drag` becomes `null`).

### Existing tests

Existing tests compare `token.move` messages exactly; update them to include
the `via` field. Nothing else in the existing suite should need to change.

## Done when

`npm run test:walls`, `npm test` and `npm run typecheck` pass, and
`docs/protocol.md` / `docs/architecture.md` describe walls and doors.
