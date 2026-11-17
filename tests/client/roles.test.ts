import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { handleKeyDown } from "../../src/client/keyboard.ts";
import type { ClientState } from "../../src/client/store.ts";
import { redactToken } from "../../src/shared/permissions.ts";
import { changeValue, installDom, pointer, type Dom } from "../helpers/dom.ts";
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

/** A player's view: tok1 controlled by John Doe, tok2 not (redacted as the server would). */
function mountPlayer(partial: Partial<ClientState> = {}): Mounted {
  const table = sampleTable();
  table.templates = [];
  table.tokens[0]!.control = { players: ["John Doe"], everyone: false };
  const other = redactToken({ ...structuredClone(table.tokens[0]!), id: "tok2", col: 6, row: 1, control: { players: [], everyone: false } });
  table.tokens.push(other);
  return mount({ me: PLAYER_USER, name: PLAYER_USER.name, table, ...partial });
}

const svg = () => ui.$("svg[data-testid=map]");
const tokenEl = (id: string) => svg().querySelector(`[data-token-id="${id}"]`)!;
const key = (k: string) => ({ key: k, shiftKey: false, target: document.body, preventDefault() {} });

describe("UI: joining", () => {
  test("the owner types the password; players leave it empty", () => {
    ui = mount({ name: null, table: null });
    const form = ui.$("form[data-testid=join]") as HTMLFormElement;
    (form.querySelector("input[name=displayName]") as HTMLInputElement).value = "Game Master";
    const pw = form.querySelector("input[name=password]") as HTMLInputElement;
    assert.equal(pw.type, "password");
    pw.value = "fake-test-password";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    assert.deepEqual(ui.joined, ["Game Master"]);
    assert.equal(pw.value, "", "the password field is cleared");
  });

  test("a refused login goes back to the join form with the reason", () => {
    ui = mount();
    ui.app.handleServerMessage({ type: "error", code: "auth_failed", message: "wrong password", ref: "hello" });
    assert.ok(ui.root.querySelector("form[data-testid=join]"));
    assert.match(ui.$(".join-notice").textContent ?? "", /wrong password/);
  });
});

describe("UI: what a player sees and can do", () => {
  test("no sidebar and no sidebar button; the tools stay", () => {
    ui = mountPlayer();
    assert.equal(ui.root.querySelector("[data-testid=sidebar]"), null);
    assert.equal(ui.root.querySelector("[data-testid=sidebar-toggle]"), null);
    assert.deepEqual(ui.$$("[data-testid=toolbar] button").map((b) => b.textContent), ["Select", "Ruler", "Ping"]);
  });

  test("the HP bar is shown only on tokens the player controls", () => {
    ui = mountPlayer();
    assert.ok(tokenEl("tok1").querySelector(".hp-bar"));
    assert.equal(tokenEl("tok2").querySelector(".hp-bar"), null);
    assert.equal(tokenEl("tok2").querySelector(".token-label")!.textContent, "Goblin 1", "names stay visible");
  });

  test("the owner sees every HP bar", () => {
    ui = mount();
    assert.ok(tokenEl("tok1").querySelector(".hp-bar"));
  });

  test("dragging a token the player does not control pans instead", () => {
    ui = mountPlayer();
    pointer(tokenEl("tok2").querySelector("ellipse")!, "pointerdown", { clientX: 325, clientY: 75 });
    pointer(svg(), "pointermove", { clientX: 375, clientY: 125 });
    pointer(svg(), "pointerup", { clientX: 375, clientY: 125 });
    assert.deepEqual(ui.sent, []);
    assert.deepEqual(ui.store.get().views.map1, { x: 50, y: 50, zoom: 1 });
    assert.equal(ui.store.get().selection, null, "and does not open its sheet");
  });

  test("the player moves their token by drag and with the keyboard", () => {
    ui = mountPlayer();
    pointer(tokenEl("tok1").querySelector("ellipse")!, "pointerdown", { clientX: 125, clientY: 175 });
    pointer(svg(), "pointermove", { clientX: 225, clientY: 175 });
    pointer(svg(), "pointerup", { clientX: 225, clientY: 175 });
    ui.app.select({ kind: "token", id: "tok1" });
    assert.equal(handleKeyDown(ui.app, key("ArrowDown")), true);
    ui.app.select({ kind: "token", id: "tok2" });
    assert.equal(handleKeyDown(ui.app, key("ArrowDown")), false, "not someone else's token");
    assert.deepEqual(ui.sent, [
      { type: "token.move", tokenId: "tok1", col: 4, row: 3 },
      { type: "token.move", tokenId: "tok1", col: 2, row: 4 },
    ]);
  });

  test("the player's sheet edits everything but has no delete / duplicate / template / control", () => {
    ui = mountPlayer();
    const t = tokenEl("tok1").querySelector("ellipse")!;
    pointer(t, "pointerdown", { clientX: 125, clientY: 175 });
    pointer(svg(), "pointerup", { clientX: 125, clientY: 175 });
    const sheet = ui.$("[data-testid=stat-sheet]");
    for (const sel of [".token-delete", ".token-duplicate", ".token-to-template", "[data-testid=control]"]) {
      assert.equal(sheet.querySelector(sel), null, sel);
    }
    changeValue(sheet.querySelector("input[name=hpCurrent]") as HTMLInputElement, "1");
    const size = sheet.querySelector("select[name=size]") as HTMLSelectElement;
    size.value = "2";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { stats: { hp: { current: 1 } } } },
      { type: "token.update", tokenId: "tok1", changes: { size: 2 } },
    ]);
  });

  test("a player cannot open the sheet of a token they do not control", () => {
    ui = mountPlayer({ selection: { kind: "token", id: "tok2" } });
    assert.equal(ui.root.querySelector("[data-testid=stat-sheet]"), null);
  });

  test("with no map shown, the player is told to wait for the game master", () => {
    ui = mountPlayer({ table: { rev: 1, activeMapId: null, maps: [], tokens: [], templates: [] } });
    assert.match(ui.$(".empty").textContent ?? "", /game master/);
  });
});

describe("UI: the owner gives control of tokens", () => {
  function openSheet(kind: "token" | "template" = "token") {
    ui = mount({ users: [OWNER_USER, PLAYER_USER, { id: "u3", name: "Mary Major", role: "player" }] });
    ui.app.select(kind === "token" ? { kind, id: "tok1" } : { kind, id: "tpl1" });
    return ui.$("[data-testid=control]");
  }

  test("to connected players in one click, or to anyone by name", () => {
    const control = openSheet();
    const quick = [...control.querySelectorAll(".control-add-user")].map((b) => b.textContent);
    assert.deepEqual(quick, ["+ John Doe", "+ Mary Major"], "only players are offered");
    (control.querySelector(".control-add-user") as HTMLElement).click();
    const form = control.querySelector("form")!;
    (form.querySelector("input[name=controlName]") as HTMLInputElement).value = "Offline Olive";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    (control.querySelector("input[name=controlEveryone]") as HTMLInputElement).click();
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { control: { players: ["John Doe"] } } },
      { type: "token.update", tokenId: "tok1", changes: { control: { players: ["Offline Olive"] } } },
      { type: "token.update", tokenId: "tok1", changes: { control: { everyone: true } } },
    ]);
  });

  test("and takes it back; templates have the same setting", () => {
    openSheet("template");
    const table = structuredClone(ui.store.get().table!);
    table.templates[0]!.control = { players: ["John Doe"], everyone: false };
    ui.store.update({ table });
    (ui.$("[data-testid=control] .control-remove") as HTMLElement).click();
    assert.deepEqual(ui.sent, [{ type: "template.update", templateId: "tpl1", changes: { control: { players: [] } } }]);
  });
});
