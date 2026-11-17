# Spec, part 3 of 3: vision and fog of war

Tests: `tests/upcoming/3-vision/` — run with **`npm run test:vision`**.
Requires part 1 (walls, `docs/spec-1-walls.md`) and part 2 (light,
`docs/spec-2-light.md`).

## Goal

Players only see what their tokens see:
- a cell is seen if it is in a token's line of sight (walls and closed doors
  block it), within its sight range, and either lit (bright or dim light) or
  within its darkvision. Lit areas are visible through darkness, from afar;
  anything in darkness is invisible without darkvision;
- what a player's tokens have seen once stays **explored**: shown greyed and
  darker, without tokens. Never-seen areas are black;
- the server only sends a player the tokens currently in a cell they see (and
  the tokens they control): a token out of sight is simply absent from their
  state, so its position cannot be read in the browser;
- the owner sees everything, can preview what any token sees and has seen,
  and can reset the fog of war.

Everything is computed per **sub-cell** at the map's cell split
(`grid.subdivisions`), using the keys `"i,j"` of part 2.

## Data model (`src/shared/types.ts`)

```ts
/** How a token sees. Distances in feet. */
export interface TokenVision {
  darkvision: number;      // 0 = none (D&D default for humans)
  range: number | null;    // maximum sight distance; null = unlimited (default)
}

export type SeenAs = "bright" | "dim" | "darkvision";

/** What a player sees on their map (only in players' views of the state). */
export interface PlayerVision {
  mapId: string | null;
  /** Sub-cells seen now, with how they are seen. */
  visible: Record<string, SeenAs>;
  /** Sub-cells seen at least once (including those seen now), sorted (see below). */
  explored: string[];
}

// Token gains:          vision: TokenVision;   default { darkvision: 0, range: null }
// TokenTemplate gains:  vision: TokenVision;   copied to placed tokens, shared by unique templates
// TableState gains:
fog: Record<string /* memory key */, Record<string /* map id */, string[] /* explored sub-cells, sorted */>>;
vision?: PlayerVision;  // set by viewFor() for players only; never stored
```

- **Memory key** (`memoryKey(token)`): `"template:<templateId>"` for a token
  placed from a template, `"token:<id>"` otherwise. So all the copies of a
  template share what they have seen.
- Sorted sub-cell lists: by row (`j`) then column (`i`), numerically.
- `emptyState()` has `fog: {}`; `migrateState()` adds `fog: {}` and gives
  tokens and templates `vision: { darkvision: 0, range: null }`. Update the
  shared test fixture `sampleTable()` in `tests/helpers/ui.ts` accordingly.

## Shared logic (`src/shared/vision.ts`)

| export | behaviour |
|---|---|
| `DEFAULT_VISION` | `{ darkvision: 0, range: null }` |
| `seeCell(level, distanceFeet, vision)` | how a cell lit at `level`, `distanceFeet` away, is seen (or `null`). If `range` is set and the distance is beyond it: `null`. `bright` → `"bright"`. `dim` → `"bright"` within darkvision (`darkvision > 0` and distance ≤ darkvision), else `"dim"`. `dark` → `"darkvision"` within darkvision, else `null` |
| `bestSeen(a, b)` | the better of two (`bright` > `dim` > `darkvision`; `undefined` loses) |
| `footprintCells(token, grid)` | keys of the sub-cells covered by the token's footprint (`footprint()` of `grid.ts`: at least one step), e.g. a 1×1 token at (2, 3) on a grid split in 2 covers `4,6`, `5,6`, `4,7`, `5,7` |
| `visibleCells(map, walls, tokens, token, light?)` | the sub-cells `token` sees on `map`, with how. `light` defaults to `computeLight(map, walls, tokens)`. For each sub-cell: `d` = distance in feet from `tokenCenter(token)` to its centre (as in part 2); it is seen if `seeCell(light, d, token.vision)` is not null **and** `lineBlocked(tokenCenter, centre, walls of the map)` is false. The token's own footprint cells are always seen (`seeCell(…) ?? "dim"`) |
| `memoryKey(token)` | see above |
| `isPlayerToken(token)` | `control.everyone` or `control.players` not empty |
| `updateFog(state)` | returns a new state where, for every player token, the sub-cells it sees now are added to `fog[memoryKey][its map id]` (sorted, without duplicates). Light is computed once per map |
| `remapFog(keys, from, to)` | explored sub-cells after a change of grid (`{ cols, rows, subdivisions }`): a new sub-cell is explored if it overlaps (positive area) an explored old one; sub-cells outside the new grid are dropped; sorted |
| `tokenVisibleTo(token, visible, grid)` | true if one of `footprintCells(token, grid)` is in `visible` |
| `playerVision(state, user)` | a player's `PlayerVision` on their map (`playerMapId()`): `visible` is the combination (`bestSeen`) of `visibleCells` of every token on that map the player controls; `explored` is the sorted union of `fog[memoryKey(t)][mapId]` for those tokens, and of `visible`. No such token: `{ mapId, visible: {}, explored: [] }` |
| `previewVision(state, tokenId)` | what one token sees and has seen (for the owner's preview): `{ mapId: token's map, visible: visibleCells(…), explored: fog[memoryKey(token)][mapId] ∪ visible }` |

## Reducer, protocol (version 10)

- After every successful intent, `applyIntent` returns `updateFog(newState)`,
  so explored areas always include what player tokens see now.
- `map.setGrid` changing `subdivisions`, `cols` or `rows` remaps the fog of
  that map (all memory keys) with `remapFog`, before the fog update above.
- Deleting a map deletes its fog entries.
- New message, **owner only**: reset the fog of war of one map, or of
  everything. Since fog is then updated, what player tokens see right now is
  explored again at once.

  ```json
  { "type": "fog.reset", "mapId": "m1" }
  { "type": "fog.reset" }
  ```
- `token.update` / `template.update` changes accept **`vision`**: a partial
  `{ "darkvision": 60, "range": null }` (darkvision 0–10 000, range 0–100 000
  or `null`, numbers with up to 2 decimals). **Owner only** (`forbidden` for
  players, like `light` and `control`). Placing a template copies its vision;
  unique templates share it.

### What players receive (`viewFor`)

For a player, in `welcome` and every `state`:
- `maps`: their map only, with `light.areas` empty (part 2);
- `tokens`: the tokens of that map they control, plus the tokens with
  `tokenVisibleTo(t, vision.visible)`; nothing else (not even redacted).
  Tokens they do not control stay redacted as before;
- `vision`: `playerVision(state, user)`;
- `fog: {}`, `walls: []`, `templates: []`, `playerMaps: {}`, `defaultMapId: null`.

The owner receives the full state (with `fog`, without `vision`).

## Client

### Rendering what is seen

When the client has a vision to show — a player (`table.vision`), or the owner
previewing a token (`previewVision`) — the map's viewport gets these layers,
each drawn as one SVG path built with `cellsPath` (below):

| element | sub-cells | look |
|---|---|---|
| `path.fog-unexplored` | neither visible nor explored | opaque black, above everything |
| `path.fog-explored` | explored but not visible | greyed and darkened (e.g. black at 60 % opacity) |
| `path.vision-dim` | seen as `dim` or `darkvision` | black at about 40 % opacity |
| `path.vision-darkvision` inside `clipPath#darkvision-clip` | seen as `darkvision` | clips a grey-scale copy of the background, `image.map-background-darkvision` (only when the map has a background image) |

A player with no tokens (or no vision yet) sees the whole grid as unexplored.

`cellsPath(keys, grid)` (`src/client/fogRender.ts`): rectangles merged into
horizontal runs: for each row `j` in increasing order, each run of consecutive
`i` in increasing order gives `M{x0} {y0}H{x1}V{y1}H{x0}Z`, with
`x0 = offsetX + i0 × cellWidth / n`, `x1 = offsetX + (iLast + 1) × cellWidth / n`,
`y0 = offsetY + j × cellHeight / n`, `y1 = y0 + cellHeight / n`, every number
written as `Number(v.toFixed(2))`. Runs are concatenated without separators.

### Owner tools

- Token and template sheets (owner only): `input[name=darkvision]` (feet) and
  `input[name=sightRange]` (feet; empty = unlimited, sent as `range: null`),
  sending `{ vision: { darkvision } }` / `{ vision: { range } }`. Players never
  see them.
- Token sheet (owner only): `button.vision-preview` starts previewing that
  token: the owner's view switches to the token's map and shows exactly what
  the token sees and has explored (the layers above, and only the tokens
  `tokenVisibleTo` that token's visible cells, plus the token itself).
  `[data-testid=preview-banner]` says so, with `button.preview-exit` to stop.
- Maps panel: `button.fog-reset-map` sends `fog.reset` for the viewed map,
  `button.fog-reset-all` sends `fog.reset` without a map.

## Done when

`npm run test:vision`, `npm run test:light`, `npm run test:walls`, `npm test`
and `npm run typecheck` pass, and `docs/protocol.md` / `docs/architecture.md`
describe vision and fog of war.
