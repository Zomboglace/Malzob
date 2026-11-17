/**
 * The map, drawn in SVG: background image, grid, tokens, and the overlays of
 * the local tools (ruler, grid calibration) and of pings.
 *
 * Pointer interactions depend on the active tool (see Tool in store.ts):
 *  - any tool:  wheel zooms around the cursor; middle-button drag pans;
 *               Alt+click pings
 *  - select:    drag a token to move it (snapped, sent live); click a token
 *               to open its sheet; drag empty space to pan; click while
 *               "placing" to create a token
 *  - ruler:     drag anywhere to measure (no snapping); shown to everyone
 *  - ping:      click to ping
 *  - calibrate: mark two cells far apart, two opposite corners each (four
 *               clicks); dragging still pans between clicks
 */
import { Component, createRef } from "preact";
import { gridFromCells, type MarkedCell, type Point, rulerDistance, snapToGrid, tokenRect, tokenSize } from "../../shared/grid.ts";
import { hpRatio } from "../../shared/stats.ts";
import type { TableMap, Token } from "../../shared/types.ts";
import type { Controller } from "../controller.ts";
import type { ActivePing, Calibration, ClientState } from "../store.ts";
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
  | { kind: "pan"; lastX: number; lastY: number; startX: number; startY: number; moved: boolean }
  | { kind: "token"; tokenId: string; startX: number; startY: number; moved: boolean; grabDx: number; grabDy: number }
  | { kind: "ruler" };

export class MapView extends Component<Props> {
  private svg = createRef<SVGSVGElement>();
  private gesture: Gesture | null = null;

  private get view(): View {
    return this.props.state.views[this.props.map.id] ?? DEFAULT_VIEW;
  }

  /** Pointer position relative to the SVG element, in screen pixels. */
  private local(e: { clientX: number; clientY: number }): Point {
    const rect = this.svg.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  private toMap(e: { clientX: number; clientY: number }): Point {
    const p = this.local(e);
    return screenToMap(this.view, p.x, p.y);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.props.app.setView(this.props.map.id, zoomAt(this.view, wheelFactor(e.deltaY), p.x, p.y));
  };

  private startPan(e: PointerEvent): void {
    this.capture(e);
    this.gesture = { kind: "pan", lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
  }

  private ping(e: PointerEvent): void {
    const m = this.toMap(e);
    this.props.app.send({ type: "ping", mapId: this.props.map.id, x: m.x, y: m.y });
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1) return this.startPan(e);
    if (e.button !== 0) return;
    const { app, state, map } = this.props;

    if (e.altKey || state.tool === "ping") return this.ping(e);

    if (state.tool === "ruler") {
      const m = this.toMap(e);
      this.capture(e);
      app.setRuler({ mapId: map.id, from: m, to: m });
      this.gesture = { kind: "ruler" };
      return;
    }

    if (state.tool === "calibrate") return this.startPan(e);

    const tokenEl = (e.target as Element).closest?.("[data-token-id]");
    const tokenId = tokenEl?.getAttribute("data-token-id");
    const token = tokenId ? state.table?.tokens.find((t) => t.id === tokenId) : undefined;

    if (state.placing && !token) {
      const m = this.toMap(e);
      const templateId = "templateId" in state.placing ? state.placing.templateId : undefined;
      const template = templateId ? state.table?.templates.find((t) => t.id === templateId) : undefined;
      const size = tokenSize({ size: template ? template.size : null }, map.grid);
      const cell = snapToGrid(m.x, m.y, map.grid, size);
      app.send({ type: "token.create", mapId: map.id, ...cell, ...(templateId ? { templateId } : {}) });
      if (!e.shiftKey) app.setPlacing(null);
      return;
    }

    if (!token) return this.startPan(e);
    this.capture(e);
    const m = this.toMap(e);
    const rect = tokenRect(token, tokenSize(token, map.grid), map.grid);
    this.gesture = {
      kind: "token",
      tokenId: token.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      grabDx: m.x - (rect.x + rect.width / 2),
      grabDy: m.y - (rect.y + rect.height / 2),
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    const { app, state, map } = this.props;
    if (!g) {
      // Live preview of the cell being marked.
      if (state.calibration?.first) app.setCalibration({ ...state.calibration, hover: this.toMap(e) });
      return;
    }
    if (g.kind === "pan") {
      app.setView(map.id, panBy(this.view, e.clientX - g.lastX, e.clientY - g.lastY));
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) >= DRAG_THRESHOLD) g.moved = true;
      return;
    }
    if (g.kind === "ruler") {
      if (state.ruler) app.setRuler({ ...state.ruler, to: this.toMap(e) });
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
    g.moved = true;
    const token = state.table?.tokens.find((t) => t.id === g.tokenId);
    if (!token) return;
    const m = this.toMap(e);
    const cell = snapToGrid(m.x - g.grabDx, m.y - g.grabDy, map.grid, tokenSize(token, map.grid));
    const current = state.drag?.tokenId === token.id ? state.drag : token;
    if (cell.col === current.col && cell.row === current.row) return;
    app.setDrag({ tokenId: token.id, ...cell });
    app.send({ type: "token.move", tokenId: token.id, ...cell });
  };

  private onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture;
    this.gesture = null;
    const { app, state } = this.props;
    if (g?.kind === "token") {
      if (!g.moved) app.select({ kind: "token", id: g.tokenId });
      app.setDrag(null);
    }
    if (g?.kind === "pan" && !g.moved && state.tool === "calibrate") this.calibrationClick(this.toMap(e));
  };

  /** One click of the grid setup: 2 corners of a first cell, then 2 corners of a second one. */
  private calibrationClick(point: Point): void {
    const { app, state, map } = this.props;
    const current = state.calibration?.mapId === map.id ? state.calibration : { mapId: map.id, cells: [], first: null, hover: null };
    if (!current.first) {
      app.setCalibration({ ...current, first: point, hover: point });
      return;
    }
    const cell: MarkedCell = [current.first, point];
    const cells = [...current.cells, cell];
    const tooSmall = gridFromCells(cell, cell) === null;
    if (tooSmall) {
      app.notify("Those two clicks are too close: click two opposite corners of the same cell.");
      app.setCalibration({ ...current, first: null, hover: null });
      return;
    }
    if (cells.length < 2) {
      app.setCalibration({ mapId: map.id, cells, first: null, hover: null });
      return;
    }
    const fit = gridFromCells(cells[0]!, cells[1]!)!;
    const { span, ...geometry } = fit;
    app.send({ type: "map.setGrid", mapId: map.id, grid: geometry });
    app.setTool("select");
    app.notify(
      `Grid set: cells of ${fmt(fit.cellWidth)} × ${fmt(fit.cellHeight)} px, measured over ${span.cols + 1} × ${span.rows + 1} cells.` +
        (span.cols < 3 || span.rows < 3 ? " For more precision, mark two cells farther apart (opposite corners of the map)." : ""),
    );
  }

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
    const ruler = state.ruler?.mapId === map.id ? state.ruler : null;
    const remoteRulers = Object.entries(state.remoteRulers).filter(([, r]) => r.mapId === map.id);
    const calibration = state.calibration?.mapId === map.id ? state.calibration : null;
    return (
      <svg
        ref={this.svg}
        class={`map tool-${state.tool} ${state.placing ? "is-placing" : ""}`}
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
          {calibration && <CalibrationPreview calibration={calibration} zoom={view.zoom} />}
          {remoteRulers.map(([userId, r]) => (
            <Ruler key={userId} from={r.from} to={r.to} map={map} zoom={view.zoom} color={r.color} owner={r.name} />
          ))}
          {ruler && <Ruler from={ruler.from} to={ruler.to} map={map} zoom={view.zoom} />}
          {state.pings
            .filter((p) => p.mapId === map.id)
            .map((p) => (
              <Ping key={p.id} ping={p} zoom={view.zoom} />
            ))}
        </g>
      </svg>
    );
  }
}

/** SVG path of the main grid lines (cell borders). */
export function gridPath(map: TableMap): string {
  const { cellWidth: w, cellHeight: h, offsetX: ox, offsetY: oy, cols, rows } = map.grid;
  const parts: string[] = [];
  for (let i = 0; i <= cols; i++) parts.push(`M${ox + i * w} ${oy}V${oy + rows * h}`);
  for (let j = 0; j <= rows; j++) parts.push(`M${ox} ${oy + j * h}H${ox + cols * w}`);
  return parts.join("");
}

/** SVG path of the sub-cell lines inside each cell (empty when the grid is not split). */
export function subGridPath(map: TableMap): string {
  const { cellWidth: w, cellHeight: h, offsetX: ox, offsetY: oy, cols, rows, subdivisions: n } = map.grid;
  if (n <= 1) return "";
  const parts: string[] = [];
  for (let i = 0; i < cols * n; i++) {
    if (i % n !== 0) parts.push(`M${ox + (i * w) / n} ${oy}V${oy + rows * h}`);
  }
  for (let j = 0; j < rows * n; j++) {
    if (j % n !== 0) parts.push(`M${ox} ${oy + (j * h) / n}H${ox + cols * w}`);
  }
  return parts.join("");
}

function Grid({ map }: { map: TableMap }) {
  const sub = subGridPath(map);
  const common = {
    fill: "none",
    stroke: map.grid.color,
    "stroke-width": 1,
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
  } as const;
  return (
    <g class="grid-layer">
      {sub && <path class="grid-sub" d={sub} {...common} stroke-opacity={Math.min(1, map.grid.opacity * 0.7)} stroke-dasharray="3 3" />}
      <path class="grid" d={gridPath(map)} {...common} stroke-opacity={map.grid.opacity} />
    </g>
  );
}

function TokenShape({ token, map, selected }: { token: Token; map: TableMap; selected: boolean }) {
  const size = tokenSize(token, map.grid);
  const { x, y, width: w, height: h } = tokenRect(token, size, map.grid);
  const inset = Math.max(0.5, Math.min(w, h) * 0.04);
  const rx = w / 2 - inset;
  const ry = h / 2 - inset;
  const ratio = hpRatio(token.stats.hp);
  const barH = Math.max(3, Math.min(map.grid.cellHeight * 0.1, h * 0.15));
  const clipId = `clip-${token.id}`;
  return (
    <g
      class={`token ${selected ? "is-selected" : ""}`}
      data-token-id={token.id}
      data-col={token.col}
      data-row={token.row}
      data-size={size}
      transform={`translate(${x} ${y})`}
    >
      <title>{token.stats.name}</title>
      <ellipse class="token-body" cx={w / 2} cy={h / 2} rx={rx} ry={ry} fill={token.color} />
      {token.image && (
        <>
          <clipPath id={clipId}>
            <ellipse cx={w / 2} cy={h / 2} rx={rx} ry={ry} />
          </clipPath>
          <image
            href={imageUrl(token.image)}
            x={inset}
            y={inset}
            width={w - 2 * inset}
            height={h - 2 * inset}
            clip-path={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      )}
      <ellipse class="token-ring" cx={w / 2} cy={h / 2} rx={rx} ry={ry} fill="none" />
      <text class="token-label" x={w / 2} y={-4} text-anchor="middle" font-size={Math.max(8, map.grid.cellHeight * 0.2)}>
        {token.stats.name}
      </text>
      <g class="hp-bar" transform={`translate(${inset} ${h + 2})`}>
        <rect class="hp-bar-bg" width={w - 2 * inset} height={barH} />
        <rect
          class="hp-bar-fill"
          width={(w - 2 * inset) * ratio}
          height={barH}
          fill={ratio > 0.5 ? "#2ecc71" : ratio > 0.25 ? "#f1c40f" : "#e74c3c"}
        />
      </g>
    </g>
  );
}

/** Formats a distance with at most one decimal: 7.5, 10. */
function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

interface RulerProps {
  from: Point;
  to: Point;
  map: TableMap;
  zoom: number;
  /** Colour and name of another user's ruler; omitted for your own. */
  color?: string;
  owner?: string;
}

export function Ruler({ from, to, map, zoom, color, owner }: RulerProps) {
  const { cells, feet } = rulerDistance(from, to, map.grid);
  const s = 1 / zoom; // keep marks and text the same size on screen at any zoom
  return (
    <g class={`ruler ${owner ? "ruler-remote" : "ruler-own"}`} data-testid={owner ? "remote-ruler" : "ruler"} pointer-events="none">
      <line class="ruler-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} vector-effect="non-scaling-stroke" />
      <circle class="ruler-end" cx={from.x} cy={from.y} r={4 * s} fill={color} />
      <circle class="ruler-end" cx={to.x} cy={to.y} r={4 * s} fill={color} />
      <text class="ruler-label" x={to.x + 10 * s} y={to.y - 10 * s} font-size={15 * s}>
        {`${fmt(feet)} ft`}
        <tspan class="ruler-cells" font-size={12 * s}>{` (${fmt(cells)} cells)`}</tspan>
        {owner && <tspan class="ruler-owner" x={to.x + 10 * s} dy={15 * s} font-size={11 * s}>{owner}</tspan>}
      </text>
    </g>
  );
}

/** The cells marked so far during grid setup, and the one being marked. */
function CalibrationPreview({ calibration, zoom }: { calibration: Calibration; zoom: number }) {
  const s = 1 / zoom;
  const cells: MarkedCell[] = [...calibration.cells];
  if (calibration.first) cells.push([calibration.first, calibration.hover ?? calibration.first]);
  return (
    <g class="calibration" data-testid="calibration" pointer-events="none">
      {cells.map(([a, b], i) => {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        return (
          <g key={i} class="calibration-marked">
            <rect class="calibration-cell" x={x} y={y} width={w} height={h} vector-effect="non-scaling-stroke" />
            <path class="calibration-mark" d={`M${a.x - 8 * s} ${a.y}h${16 * s}M${a.x} ${a.y - 8 * s}v${16 * s}`} vector-effect="non-scaling-stroke" />
            {w > 0 && h > 0 && (
              <text class="ruler-label" x={x + w + 6 * s} y={y + h + 14 * s} font-size={13 * s}>
                {`${i + 1}: ${fmt(w)} × ${fmt(h)} px`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Ping({ ping, zoom }: { ping: ActivePing; zoom: number }) {
  const r = 48 / zoom;
  return (
    <g class="ping" data-testid="ping" transform={`translate(${ping.x} ${ping.y})`} pointer-events="none">
      <circle class="ping-ring" r={r} stroke={ping.color} vector-effect="non-scaling-stroke" />
      <circle class="ping-ring ping-ring-late" r={r} stroke={ping.color} vector-effect="non-scaling-stroke" />
      <circle class="ping-dot" r={4 / zoom} fill={ping.color} />
      <text class="ping-label" y={-r * 0.35} font-size={12 / zoom} text-anchor="middle">
        {ping.name}
      </text>
    </g>
  );
}
