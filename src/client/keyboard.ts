/**
 * Keyboard shortcuts, kept out of main.tsx so they can be tested.
 *
 *   Arrow keys        move the selected token by one step (a sub-cell when
 *                     the grid is split, otherwise one cell)
 *   Shift + arrows    move it by one full cell
 *   Escape            leave the current tool (ruler, ping, grid setup), else
 *                     cancel placing, else close the stat sheet
 *
 * Keys typed into form fields are ignored.
 */
import { moveBy, snapStep, tokenSize } from "../shared/grid.ts";
import { canControl } from "../shared/permissions.ts";
import type { Controller } from "./controller.ts";

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target: EventTarget | null;
  preventDefault(): void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable === true;
}

/** Handles a keydown event. Returns true if the key was used. */
export function handleKeyDown(app: Controller, e: KeyLike): boolean {
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
  const state = app.store.get();

  if (e.key === "Escape") {
    if (state.tool !== "select" || state.ruler) app.setTool("select");
    else if (state.placing) app.setPlacing(null);
    else app.select(null);
    return true;
  }

  const dir = ARROWS[e.key];
  if (!dir || state.selection?.kind !== "token" || !state.table) return false;
  const tokenId = state.selection.id;
  const token = state.table.tokens.find((t) => t.id === tokenId);
  const map = token && state.table.maps.find((m) => m.id === token.mapId);
  if (!token || !map || !canControl(state.me, token)) return false;

  e.preventDefault(); // do not scroll the page
  const step = e.shiftKey ? 1 : snapStep(map.grid);
  const next = moveBy(token, dir[0], dir[1], step, map.grid, tokenSize(token, map.grid));
  if (next.col !== token.col || next.row !== token.row) {
    app.send({ type: "token.move", tokenId: token.id, ...next });
  }
  return true;
}
