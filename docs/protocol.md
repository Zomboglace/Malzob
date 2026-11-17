# WebSocket protocol

Version: **2** (`PROTOCOL_VERSION` in `src/shared/protocol.ts`, which is the
source of truth for the types below).

- Endpoint: `ws://<host>:<port>/ws` (`wss://` behind HTTPS).
- Every frame is a UTF-8 **text** frame holding one JSON object with a `type`
  field. Binary frames are rejected.
- Frames larger than 256 KiB close the connection (close code `1009`).
  Images never go through the socket; they are uploaded over HTTP (see below).
- Clients send **intents**. The server validates each one (`src/shared/validate.ts`),
  applies it to the authoritative state (`src/shared/reducer.ts`), saves the
  state, then broadcasts it. Unknown fields are rejected, strings are trimmed
  and length-limited, numbers must be within range (see `LIMITS`). Counts
  (`cols`, `rows`, `size`, `subdivisions`, stats) must be integers; grid
  geometry and positions may be fractional and are rounded (4 decimals for
  pixels, 6 for positions).
- Positions are in **grid cells** (`col`, `row` = top-left of the token).
  When the map's grid is split (`subdivisions` > 1) positions can be fractional,
  in steps of `1 / subdivisions` (e.g. `2.5` with a 2 × 2 split). The server
  snaps them to that step and clamps them so a token always stays inside the grid.

Changes in version 2: `cellSize`, `offsetX`, `offsetY` accept sub-pixel
values; new grid fields `feetPerCell` and `subdivisions`; token `col`/`row`
can be fractional.

## Session flow

```
client                                  server
  | -- connect /ws ----------------------> |
  | -- {"type":"hello","name":"Jane Doe"}> |
  | <------------------------ welcome ---- |  (you, full state, users)
  | <------------------------ users ------ |  (to everyone)
  | -- {"type":"token.move", ...} -------> |
  | <------------------------ state ------ |  (to everyone, full state)
  | -- {"type":"token.move", bad} -------> |
  | <------------------------ error ------ |  (to the sender only)
```

Until a client has sent `hello`, every other message is answered with an
`error` (`not_ready`) and it receives no broadcasts.

On reconnection the client simply sends `hello` again and receives a fresh
`welcome` with the full state: this is how clients resync.

---

## Client → server

### Session

#### `hello`
Join the table with a display name (1–80 characters). Must be the first message.
```json
{ "type": "hello", "name": "Jane Doe" }
```

#### `user.rename`
Change your display name.
```json
{ "type": "user.rename", "name": "Jane D." }
```

### Maps

#### `map.create`
Create a map (20×15 cells of 70 px until a background is set). The first map
created becomes the active one.
```json
{ "type": "map.create", "name": "Goblin cave" }
```

#### `map.rename`
```json
{ "type": "map.rename", "mapId": "8c1f…", "name": "Goblin cave, level 2" }
```

#### `map.delete`
Deletes the map **and all its tokens**. If it was active, the first remaining
map (or none) becomes active.
```json
{ "type": "map.delete", "mapId": "8c1f…" }
```

#### `map.activate`
Show this map to everyone.
```json
{ "type": "map.activate", "mapId": "8c1f…" }
```

#### `map.setBackground`
Use an uploaded image (by hash, see *HTTP*) as the background, or `null` to
remove it. The server looks the image up itself (it does not trust a size sent
by the client), sets the map's natural size to the image size, and derives the
number of columns/rows from the image and the current cell size and offset.
```json
{ "type": "map.setBackground", "mapId": "8c1f…", "image": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b" }
```

#### `map.setGrid`
Partial update of the grid settings. All fields are optional:

| field      | type    | range            |
|------------|---------|------------------|
| `cellSize` | number  | 4–1000 (px, sub-pixel allowed) |
| `offsetX`  | number  | −10000–10000 (px, sub-pixel allowed) |
| `offsetY`  | number  | −10000–10000 (px, sub-pixel allowed) |
| `feetPerCell` | number | 0.1–1000 (default 5) |
| `subdivisions` | integer | 1–10: each cell is split into n × n sub-cells that tokens snap to (1 = no split) |
| `cols`     | integer | 1–500            |
| `rows`     | integer | 1–500            |
| `color`    | string  | `#rrggbb`        |
| `opacity`  | number  | 0–1              |
| `visible`  | boolean |                  |

If the map has a background and `cellSize`/`offsetX`/`offsetY` change without
explicit `cols`/`rows`, columns and rows are re-derived from the image. Tokens
are re-snapped (to the new `subdivisions`) and re-clamped inside the new grid.
```json
{ "type": "map.setGrid", "mapId": "8c1f…", "grid": { "cellSize": 70.25, "offsetX": 12.5, "opacity": 0.5 } }
{ "type": "map.setGrid", "mapId": "8c1f…", "grid": { "feetPerCell": 5, "subdivisions": 2 } }
```

### Tokens

#### `token.create`
Place a token on a map. With `templateId`, the token gets an independent copy
of the template's stats, size, colour and image; without it, a blank 1×1 token.
```json
{ "type": "token.create", "mapId": "8c1f…", "col": 4, "row": 7, "templateId": "b02e…" }
```

#### `token.move`
Sent live while dragging (each time the token enters a new cell or sub-cell)
and for each arrow-key move.
```json
{ "type": "token.move", "tokenId": "d4a9…", "col": 5, "row": 7 }
{ "type": "token.move", "tokenId": "d4a9…", "col": 5.5, "row": 7 }
```

#### `token.update`
Partial update of a token. `changes` may hold `size` (1–10 cells), `color`
(`#rrggbb`), `image` (hash or `null`) and `stats`, a partial stat sheet where
`hp` and `abilities` are partial too. The token's name is `stats.name`.
Never affects the template or other tokens.
```json
{
  "type": "token.update",
  "tokenId": "d4a9…",
  "changes": {
    "stats": { "hp": { "current": 3 }, "abilities": { "str": 14 }, "conditions": ["prone", "poisoned"] }
  }
}
```

Stat sheet fields: `name` (string), `ac`, `speed` (integers), `hp`
(`{ current, max, temp }`), `abilities` (`{ str, dex, con, int, wis, cha }`,
0–50), `proficiencyBonus`, `initiativeBonus` (−50–50), `conditions` (array of
standard 5e conditions: blinded, charmed, deafened, exhaustion, frightened,
grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone,
restrained, stunned, unconscious; replaces the whole list), `notes` (string,
up to 20 000 characters).

#### `token.duplicate`
Copies a token with its **current** stats, placed next to it.
```json
{ "type": "token.duplicate", "tokenId": "d4a9…" }
```

#### `token.delete`
```json
{ "type": "token.delete", "tokenId": "d4a9…" }
```

### Templates

#### `template.create`
Create a template with default stats, or from a token's current stats and
appearance (`fromTokenId`). `name` becomes the template's `stats.name`.
```json
{ "type": "template.create", "name": "Goblin" }
{ "type": "template.create", "name": "Goblin boss", "fromTokenId": "d4a9…" }
```

#### `template.update`
Same `changes` as `token.update`. Never affects tokens already placed.
```json
{ "type": "template.update", "templateId": "b02e…", "changes": { "size": 2, "stats": { "ac": 15, "hp": { "current": 7, "max": 7 } } } }
```

#### `template.delete`
Tokens created from it are kept (their `templateId` becomes `null`).
```json
{ "type": "template.delete", "templateId": "b02e…" }
```

---

## Server → client

#### `welcome`
Answer to `hello`: who you are, the full state and the connected users.
```json
{
  "type": "welcome",
  "protocol": 2,
  "you": { "id": "5d0c…", "name": "Jane Doe" },
  "state": { "rev": 12, "activeMapId": "8c1f…", "maps": [], "tokens": [], "templates": [] },
  "users": [{ "id": "5d0c…", "name": "Jane Doe" }]
}
```

#### `state`
Broadcast to every joined client after each accepted intent. Carries the
**full** state; `rev` increases by one per change. (A future version may send
patches instead; `rev` makes that possible without changing the model.)
```json
{
  "type": "state",
  "state": {
    "rev": 13,
    "activeMapId": "8c1f…",
    "maps": [
      {
        "id": "8c1f…",
        "name": "Goblin cave",
        "background": { "hash": "3a7b…", "ext": "png", "width": 1400, "height": 1050 },
        "width": 1400,
        "height": 1050,
        "grid": {
          "cellSize": 70, "offsetX": 0, "offsetY": 0, "feetPerCell": 5, "subdivisions": 2,
          "cols": 20, "rows": 15, "color": "#000000", "opacity": 0.35, "visible": true
        }
      }
    ],
    "tokens": [
      {
        "id": "d4a9…",
        "mapId": "8c1f…",
        "templateId": "b02e…",
        "col": 5.5,
        "row": 7,
        "size": 1,
        "color": "#c0392b",
        "image": null,
        "stats": {
          "name": "Goblin 1",
          "ac": 15,
          "hp": { "current": 3, "max": 7, "temp": 0 },
          "speed": 30,
          "abilities": { "str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8 },
          "proficiencyBonus": 2,
          "initiativeBonus": 2,
          "conditions": ["prone"],
          "notes": ""
        }
      }
    ],
    "templates": []
  }
}
```

#### `users`
Broadcast when someone joins, leaves or renames.
```json
{ "type": "users", "users": [{ "id": "5d0c…", "name": "Jane Doe" }, { "id": "77aa…", "name": "John Doe" }] }
```

#### `error`
Sent **only** to the client whose message was rejected; the state is unchanged.
`ref` is the `type` of the rejected message when it could be read.

| code        | meaning                                              |
|-------------|------------------------------------------------------|
| `bad_json`  | the frame is not valid JSON                          |
| `invalid`   | unknown type, missing/unknown field, out of range    |
| `not_found` | the map/token/template/image referenced does not exist |
| `not_ready` | an intent was sent before `hello`                    |

```json
{ "type": "error", "code": "not_found", "message": "token d4a9 not found", "ref": "token.move" }
```

---

## HTTP

| method | path                 | description |
|--------|----------------------|-------------|
| GET    | `/`, `/app.js`, …    | the built client (`build/public`) |
| POST   | `/api/images`        | upload an image: raw bytes as the body, `Content-Type` `image/png`, `image/jpeg` or `image/webp`, at most 15 MiB. The server checks the real format from the bytes. |
| GET    | `/images/<hash>.<ext>` | an uploaded image (immutable, cached for a year) |

Upload response (`201`):
```json
{ "hash": "3a7bd3e2…4f1b", "ext": "png", "width": 1400, "height": 1050 }
```
Errors: `400` not a valid image, `413` too large, `415` wrong content type,
each with a JSON body `{ "error": "…" }`.

Then reference the image from a message, e.g. `map.setBackground` or
`token.update` with `"image": "<hash>"`.
