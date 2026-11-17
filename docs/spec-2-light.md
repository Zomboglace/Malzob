# Spec, part 2 of 3: light

Tests: `tests/upcoming/2-light/` — run with **`npm run test:light`**.
Requires part 1 (walls, `docs/spec-1-walls.md`). Part 3 (vision and fog of war)
uses the light computed here to decide what each token sees.

## Goal

Each map has a light level everywhere (**bright**, **dim** or **dark**, as in
D&D 5e). The owner paints areas with another level, at the precision of the
map's cell split. Tokens can carry a light (torch, lantern…) that lights the
area around them; walls block that light. Light is only stored and computed in
this part; what players see because of it comes in part 3.

## Data model (`src/shared/types.ts`)

```ts
export type LightLevel = "dark" | "dim" | "bright";

export interface MapLight {
  /** Level everywhere that is not painted. */
  base: LightLevel;
  /**
   * Painted sub-cells, at the map's current `grid.subdivisions`: key "i,j" where
   * sub-cell (i, j) covers [i/n, (i+1)/n] × [j/n, (j+1)/n] in cells.
   */
  areas: Record<string, LightLevel>;
}

/** A light carried by a token, in feet: bright up to `bright`, dim for `dim` feet beyond. */
export interface TokenLight {
  bright: number;
  dim: number;
}

// TableMap gains:   light: MapLight;            new maps: { base: "bright", areas: {} }
// Token gains:      light: TokenLight | null;   blank tokens: null
// TokenTemplate gains: light: TokenLight | null; new templates: null
```

- `migrateState()` gives older maps `{ base: "bright", areas: {} }` and older
  tokens and templates `light: null` (so existing tables look the same).
- Update the shared test fixture `sampleTable()` in `tests/helpers/ui.ts` with
  these defaults.

## Shared logic (`src/shared/light.ts`)

| export | behaviour |
|---|---|
| `LIGHT_LEVELS = ["dark", "dim", "bright"]` | from darkest to brightest |
| `brighter(a, b)` | the brighter of two levels |
| `LIGHT_PRESETS` | `{ torch: { bright: 20, dim: 20 }, lantern: { bright: 30, dim: 30 }, candle: { bright: 5, dim: 5 } }` |
| `subCellKey(i, j)` | `"i,j"` |
| `parseSubCellKey(key)` | `[i, j]` |
| `subCellCenter(i, j, subdivisions)` | centre in cells: `{ col: (i + 0.5) / n, row: (j + 0.5) / n }` |
| `tokenCenter(token, grid)` | centre in cells of the token's footprint: `col + f / 2`, `row + f / 2`, where `f = footprint(tokenSize(token, grid), grid)` (see `grid.ts`) |
| `remapLightAreas(areas, base, from, to)` | painted areas after a change of grid: `from` / `to` are `{ cols, rows, subdivisions }`. See below |
| `computeLight(map, walls, tokens)` | the light level of every sub-cell of the map: an array of rows, `result[j][i]`, of size `rows × n` by `cols × n`. Only the walls and tokens whose `mapId` is the map's id are used. See below |

### `remapLightAreas`

For each sub-cell of the new grid (inside `to.cols × to.rows`), look at the
sub-cells of the old grid it overlaps, weighted by overlap area; unpainted
old sub-cells count as `base`. The level covering the largest area wins; on a
tie (equal areas), the brighter level wins. The result only contains the
sub-cells whose winning level is **not** `base`. So:

- more sub-cells (e.g. 1 → 2): each new sub-cell keeps the level of the cell it
  is in;
- fewer sub-cells (e.g. 2 → 1): each cell takes the level found most among its
  sub-cells, the brighter one on a tie;
- non-multiples (e.g. 2 → 3) work the same way, by area;
- sub-cells outside the new grid (fewer columns or rows) are dropped.

### `computeLight`

The level of sub-cell (i, j) is the brightest of:
- its painted level (`areas["i,j"]`), or `base` if not painted;
- for each token on the map with a `light`: let `d` be the distance in feet
  from `tokenCenter(token)` to `subCellCenter(i, j)`, i.e. the straight-line
  distance in cells (horizontal and vertical distances in cells, whatever the
  pixel size of the cells) times `grid.feetPerCell`. If
  `lineBlocked(tokenCenter, subCellCenter, walls)` (part 1, sight-blocking
  walls: walls and closed doors; see-through walls and open doors let light
  through), the token adds nothing. Otherwise: `d ≤ bright` → bright;
  `d ≤ bright + dim` → dim.

## Protocol (version 9)

New client messages, **owner only**:

```json
{ "type": "light.setBase", "mapId": "m1", "level": "dark" }
{ "type": "light.paint", "mapId": "m1", "cells": [[3, 4], [4, 4]], "level": "dim" }
{ "type": "light.paint", "mapId": "m1", "cells": [[3, 4]], "level": null }
```

- `light.paint`: `cells` is a list of `[i, j]` sub-cell indices (non-negative
  integers, at most 10 000 per message) at the map's current split; `level`
  `null` erases (back to `base`). The reducer stores the level as given (even
  when it equals `base`) and ignores cells outside the grid.
- `token.update` and `template.update` changes accept **`light`**:
  `{ "bright": 20, "dim": 20 }` (numbers 0–1000, 2 decimals) or `null`. Only the
  owner may change `light` (a player editing a token they control gets
  `forbidden` if `changes.light` is present).
- Placing a template copies its `light` (`newToken()`); unique templates share
  it with their tokens like every other appearance field.
- `map.setGrid` changing `subdivisions`, `cols` or `rows` remaps the painted
  areas with `remapLightAreas`.
- Players: `viewFor()` sends their map with `light.areas` emptied (`{}`; `base`
  kept). Part 3 will send them what they can see instead.

## Client (owner only)

### Map light

The grid settings get `select[name=mapLight]` (`dark`, `dim`, `bright`) →
`light.setBase`.

### Light tool

- The map toolbar gets a **Light** button (`.tool-light`, tool `"light"`),
  owner only.
- While active, `[data-testid=light-options]` shows `select[name=lightLevel]`:
  `bright`, `dim`, `dark`, `erase` (default `bright`).
- Painting: pressing the left button adds the sub-cell under the pointer
  (`i = floor((x - offsetX) / cellWidth × n)`, same for `j`; ignored outside
  the grid); moving with the button pressed adds each new sub-cell crossed
  (once, in the order first reached); releasing sends **one** `light.paint`
  with all of them, `level` being the chosen level or `null` for `erase`. The
  middle button still pans.
- While the tool is active, painted sub-cells are drawn as
  `rect.light-area[data-cell="i,j"][data-level=…]`, and the sub-cells of the
  stroke in progress as `rect.light-area.is-pending`. They are not drawn when
  another tool is active.

### Token and template light

The owner's token and template sheets get `select[name=lightPreset]`: `none`,
`torch`, `lantern`, `candle`, `custom`. It shows `none` for `light: null`, a
preset's name when `light` equals that preset, `custom` otherwise.
- Choosing a preset sends `{ light: <preset> }`; `none` sends `{ light: null }`.
- Choosing `custom` sends nothing; it shows `input[name=lightBright]` and
  `input[name=lightDim]` (feet, decimals allowed), filled with the current
  values (0 if none). Committing one of them sends `{ light: { bright, dim } }`
  with the other value kept.

Players never see these controls (not even for tokens they control) and have
no Light tool.

## Done when

`npm run test:light`, `npm run test:walls`, `npm test` and
`npm run typecheck` pass, and `docs/protocol.md` / `docs/architecture.md`
describe light.
