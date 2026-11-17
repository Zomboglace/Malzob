/** Tool buttons shown over the map, and the hint for the active tool. */
import type { Controller } from "../controller.ts";
import type { ClientState, Tool } from "../store.ts";

const TOOLS: Array<{ tool: Tool; label: string; title: string }> = [
  { tool: "select", label: "Select", title: "Select and move tokens, drag empty space to pan" },
  { tool: "ruler", label: "Ruler", title: "Drag anywhere to measure a distance" },
  { tool: "ping", label: "Ping", title: "Click to point a spot out to everyone (or Alt+click with any tool)" },
];
// Grid setup ("calibrate") is started from the sidebar's grid settings, not from this toolbar.

export function toolHint(state: ClientState): string | null {
  switch (state.tool) {
    case "ruler":
      return "Drag anywhere to measure; everyone sees your ruler. Esc to stop.";
    case "ping":
      return "Click to ping a spot for everyone. Tip: Alt+click pings with any tool.";
    case "calibrate": {
      const done = state.calibration?.cells.length ?? 0;
      const corner = state.calibration?.first ? "the opposite corner" : "one corner";
      if (done === 0) {
        return `Grid setup, cell 1 of 2: click ${corner} of a cell near one edge of the map. Zoom in (wheel) and drag to pan for precision. Esc to cancel.`;
      }
      return `Grid setup, cell 2 of 2: click ${corner} of a cell far from the first one (ideally the opposite corner of the map).`;
    }
    default:
      return null;
  }
}

export function MapToolbar({ app, state }: { app: Controller; state: ClientState }) {
  const hint = toolHint(state);
  return (
    <div class="map-overlay">
      <div class="toolbar" role="toolbar" aria-label="Map tools" data-testid="toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            class={`tool tool-${t.tool} ${state.tool === t.tool ? "is-on" : ""}`}
            title={t.title}
            aria-pressed={state.tool === t.tool}
            onClick={() => app.setTool(t.tool)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {hint && (
        <p class="tool-hint" data-testid="tool-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
