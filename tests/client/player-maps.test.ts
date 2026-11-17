import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { TableState } from "../../src/shared/types.ts";
import { changeValue, installDom, type Dom } from "../helpers/dom.ts";
import { mount, OWNER_USER, PLAYER_USER, sampleTable, type Mounted } from "../helpers/ui.ts";

let dom: Dom;
let ui: Mounted;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

function twoMaps(): TableState {
  const t = sampleTable();
  t.maps.push({ ...structuredClone(t.maps[0]!), id: "map2", name: "Dungeon" });
  t.playerMaps = { "mary major": { name: "Mary Major", mapId: "map2" } };
  return t;
}

const users = [OWNER_USER, PLAYER_USER];

describe("UI: the owner's own view and the players' maps", () => {
  test("clicking a map shows it to the owner only; nothing is sent", () => {
    ui = mount({ table: twoMaps(), users });
    assert.equal(ui.$("svg[data-testid=map]").querySelectorAll(".token").length, 1, "first map by default");
    (ui.$('[data-map-id="map2"] .map-view') as HTMLElement).click();
    assert.deepEqual(ui.sent, []);
    assert.equal(ui.store.get().viewMapId, "map2");
    assert.ok(ui.$('[data-map-id="map2"]').classList.contains("is-active"));
    assert.equal(ui.$("input[name=activeMapName]").getAttribute("name"), "activeMapName");
    assert.equal((ui.$("input[name=activeMapName]") as HTMLInputElement).value, "Dungeon", "settings follow the viewed map");
    assert.equal(ui.$("svg[data-testid=map]").querySelectorAll(".token").length, 0);
  });

  test("the first map is marked as where new players start, with player counts", () => {
    ui = mount({ table: twoMaps(), users });
    assert.ok(ui.$('[data-map-id="map1"] .map-first'));
    assert.equal(ui.root.querySelector('[data-map-id="map2"] .map-first'), null);
    assert.equal(ui.$('[data-map-id="map1"] .map-player-count').textContent, "1"); // John (default)
    assert.equal(ui.$('[data-map-id="map2"] .map-player-count').textContent, "1"); // Mary (sent there)
  });

  test("the Players panel lists connected and offline players with their map, and sends one player", () => {
    ui = mount({ table: twoMaps(), users });
    const rows = ui.$$("[data-testid=players-panel] li");
    assert.deepEqual(rows.map((r) => [r.dataset.player, r.className]), [
      ["John Doe", "is-online"],
      ["Mary Major", "is-offline"],
    ]);
    const john = rows[0]!.querySelector("select") as HTMLSelectElement;
    assert.equal(john.value, "map1");
    john.value = "map2";
    john.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [{ type: "player.setMap", player: "John Doe", mapId: "map2" }]);
  });

  test("'Bring all players here' sends every player who is elsewhere to the viewed map", () => {
    ui = mount({ table: twoMaps(), users });
    (ui.$('[data-map-id="map2"] .map-view') as HTMLElement).click();
    ui.$(".bring-players").click();
    assert.deepEqual(ui.sent, [{ type: "player.setMap", player: "John Doe", mapId: "map2" }]);
  });

  test("players have no maps list or players panel (they only see their map)", () => {
    const t = sampleTable();
    t.templates = [];
    ui = mount({ me: PLAYER_USER, table: t, users });
    assert.equal(ui.root.querySelector("[data-testid=players-panel]"), null);
    assert.ok(ui.root.querySelector("svg[data-testid=map]"));
  });
});

describe("UI: unique templates", () => {
  test("the owner ticks 'Unique' on a template; it is marked in the list", () => {
    ui = mount({ users });
    ui.app.select({ kind: "template", id: "tpl1" });
    (ui.$("input[name=unique]") as HTMLInputElement).click();
    assert.deepEqual(ui.sent, [{ type: "template.update", templateId: "tpl1", changes: { unique: true } }]);
    const table = structuredClone(ui.store.get().table!);
    table.templates[0]!.unique = true;
    ui.store.update({ table });
    assert.ok(ui.$('[data-template-id="tpl1"] .unique-mark'));
  });

  test("a token of a unique template says that edits also update the template", () => {
    const table = sampleTable();
    table.templates[0]!.unique = true;
    ui = mount({ table, users });
    ui.app.select({ kind: "token", id: "tok1" });
    assert.match(ui.$("[data-testid=unique-hint]").textContent ?? "", /“Goblin”/);
    changeValue(ui.$("input[name=hpCurrent]") as HTMLInputElement, "2");
    assert.deepEqual(ui.sent, [{ type: "token.update", tokenId: "tok1", changes: { stats: { hp: { current: 2 } } } }], "one message; the server updates both");
  });
});
