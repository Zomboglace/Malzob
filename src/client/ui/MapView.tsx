/**
 * The map, drawn in SVG: background image, grid and tokens.
 *
 * Interactions:
 *  - wheel: zoom around the cursor (local)
 *  - drag on empty space: pan (local)
 *  - drag a token: move it, snapped to the grid; sent live to the server
 *  - click a token: open its stat sheet
 *  - click the map while "placing": create a token in that cell
 */
import { Component, createRef } from "preact";
import { cellToPixel, snapToGrid } from "../../shared/grid.ts";
import { hpRatio } from "../../shared/stats.ts";
import type { TableMap, Token } from "../../shared/types.ts";
import type { Controller } from "../controller.ts";
import type { ClientState } from "../store.ts";
import { imageUrl } from "../upload.ts";
import { DEFAULT_VIEW, panBy, screenToMap, type View, wheelFactor, zoomAt } from "../view.ts";

interface Props {
  app: Controller;
  state: ClientState;
  map: TableMap;
}

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

type Gesture =
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "token"; tokenId: string; startX: number; startY: number; moved: boolean; grabDx: number; grabDy: number };

export class MapView extends Component<Props> {
  private svg = createRef<SVGSVGElement>();
  private gesture: Gesture | null = null;

  private get view(): View {
    return this.props.state.views[this.props.map.id] ?? DEFAULT_VIEW;
  }

  /** Pointer position relative to the SVG element, in screen pixels. */
  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.svg.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  private toMap(e: { clientX: number; clientY: number }) {
    const p = this.local(e);
    return screenToMap(this.view, p.x, p.y);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.props.app.setView(this.props.map.id, zoomAt(this.view, wheelFactor(e.deltaY), p.x, p.y));
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const { app, state, map } = this.props;
    const tokenEl = (e.target as Element).closest?.("[data-token-id]");
    const tokenId = tokenEl?.getAttribute("data-token-id");
    const token = tokenId ? state.table?.tokens.find((t) => t.id === tokenId) : undefined;

    if (state.placing && !token) {
      const m = this.toMap(e);
      const templateId = "templateId" in state.placing ? state.placing.templateId : undefined;
      const size = templateId ? (state.table?.templates.find((t) => t.id === templateId)?.size ?? 1) : 1;
      const cell = snapToGrid(m.x, m.y, map.grid, size);
      app.send({ type: "token.create", mapId: map.id, ...cell, ...(templateId ? { templateId } : {}) });
      if (!e.shiftKey) app.setPlacing(null);
      return;
    }

    this.capture(e);
    if (token) {
      const m = this.toMap(e);
      const origin = cellToPixel(token, map.grid);
      const half = (token.size * map.grid.cellSize) / 2;
      this.gesture = {
        kind: "token",
        tokenId: token.id,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        grabDx: m.x - (origin.x + half),
        grabDy: m.y - (origin.y + half),
      };
    } else {
      this.gesture = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g) return;
    const { app, state, map } = this.props;
    if (g.kind === "pan") {
      app.setView(map.id, panBy(this.view, e.clientX - g.lastX, e.clientY - g.lastY));
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
    g.moved = true;
    const token = state.table?.tokens.find((t) => t.id === g.tokenId);
    if (!token) return;
    const m = this.toMap(e);
    const cell = snapToGrid(m.x - g.grabDx, m.y - g.grabDy, map.grid, token.size);
    const current = state.drag?.tokenId === token.id ? state.drag : token;
    if (cell.col === current.col && cell.row === current.row) return;
    app.setDrag({ tokenId: token.id, ...cell });
    app.send({ type: "token.move", tokenId: token.id, ...cell });
  };

  private onPointerUp = (): void => {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === "token") {
      if (!g.moved) this.props.app.select({ kind: "token", id: g.tokenId });
      this.props.app.setDrag(null);
    }
  };

  private capture(e: PointerEvent): void {
    try {
      this.svg.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // Not supported (e.g. in some test DOMs); dragging still works without it.
    }
  }

  override componentDidMount(): void {
    // Registered by hand so that preventDefault() works (non-passive listener).
    this.svg.current?.addEventListener("wheel", this.onWheel, { passive: false });
  }

  override componentWillUnmount(): void {
    this.svg.current?.removeEventListener("wheel", this.onWheel);
  }

  render() {
    const { state, map } = this.props;
    const view = this.view;
    const tokens = (state.table?.tokens ?? []).filter((t) => t.mapId === map.id);
    const selectedId = state.selection?.kind === "token" ? state.selection.id : null;
    return (
      <svg
        ref={this.svg}
        class={`map ${state.placing ? "is-placing" : ""}`}
        data-testid="map"
        onPointerDown={this.onPointerDown}
        onPointerMove={this.onPointerMove}
        onPointerUp={this.onPointerUp}
        onPointerCancel={this.onPointerUp}
      >
        <g class="viewport" transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {map.background ? (
            <image class="map-background" href={imageUrl(map.background)} width={map.width} height={map.height} />
          ) : (
            <rect class="map-background map-background-empty" width={map.width} height={map.height} />
          )}
          {map.grid.visible && <Grid map={map} />}
          <g class="tokens">
            {tokens.map((t) => (
              <TokenShape
                key={t.id}
                token={state.drag?.tokenId === t.id ? { ...t, col: state.drag.col, row: state.drag.row } : t}
                map={map}
                selected={t.id === selectedId}
              />
            ))}
          </g>
        </g>
      </svg>
    );
  }
}

export function gridPath(map: TableMap): string {
  const { cellSize: c, offsetX: ox, offsetY: oy, cols, rows } = map.grid;
  const parts: string[] = [];
  for (let i = 0; i <= cols; i++) parts.push(`M${ox + i * c} ${oy}V${oy + rows * c}`);
  for (let j = 0; j <= rows; j++) parts.push(`M${ox} ${oy + j * c}H${ox + cols * c}`);
  return parts.join("");
}

function Grid({ map }: { map: TableMap }) {
  return (
    <path
      class="grid"
      d={gridPath(map)}
      fill="none"
      stroke={map.grid.color}
      stroke-opacity={map.grid.opacity}
      stroke-width={1}
      vector-effect="non-scaling-stroke"
      pointer-events="none"
    />
  );
}

function TokenShape({ token, map, selected }: { token: Token; map: TableMap; selected: boolean }) {
  const { x, y } = cellToPixel(token, map.grid);
  const side = token.size * map.grid.cellSize;
  const r = side / 2;
  const inset = Math.max(1, side * 0.04);
  const ratio = hpRatio(token.stats.hp);
  const barH = Math.max(4, map.grid.cellSize * 0.1);
  const clipId = `clip-${token.id}`;
  return (
    <g
      class={`token ${selected ? "is-selected" : ""}`}
      data-token-id={token.id}
      data-col={token.col}
      data-row={token.row}
      transform={`translate(${x} ${y})`}
    >
      <title>{token.stats.name}</title>
      <circle class="token-body" cx={r} cy={r} r={r - inset} fill={token.color} />
      {token.image && (
        <>
          <clipPath id={clipId}>
            <circle cx={r} cy={r} r={r - inset} />
          </clipPath>
          <image
            href={imageUrl(token.image)}
            x={inset}
            y={inset}
            width={side - 2 * inset}
            height={side - 2 * inset}
            clip-path={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      )}
      <circle class="token-ring" cx={r} cy={r} r={r - inset} fill="none" />
      <text class="token-label" x={r} y={-4} text-anchor="middle" font-size={Math.max(10, map.grid.cellSize * 0.2)}>
        {token.stats.name}
      </text>
      <g class="hp-bar" transform={`translate(${inset} ${side + 2})`}>
        <rect class="hp-bar-bg" width={side - 2 * inset} height={barH} />
        <rect
          class="hp-bar-fill"
          width={(side - 2 * inset) * ratio}
          height={barH}
          fill={ratio > 0.5 ? "#2ecc71" : ratio > 0.25 ? "#f1c40f" : "#e74c3c"}
        />
      </g>
    </g>
  );
}
