/** Map list (create, rename, delete, activate), background upload and grid settings. */
import { subCellFeet } from "../../shared/grid.ts";
import { LIMITS } from "../../shared/validate.ts";
import type { TableMap } from "../../shared/types.ts";
import type { Controller } from "../controller.ts";
import type { ClientState } from "../store.ts";
import { ColorField, ImagePicker, NumberField, TextField } from "./fields.tsx";
import { SizeSelect } from "./SizeSelect.tsx";

interface Props {
  app: Controller;
  state: ClientState;
}

export function MapsPanel({ app, state }: Props) {
  const table = state.table;
  if (!table) return null;
  const active = table.maps.find((m) => m.id === table.activeMapId) ?? null;

  const create = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("mapName") as HTMLInputElement;
    const name = input.value.trim() || `Map ${table.maps.length + 1}`;
    app.send({ type: "map.create", name });
    input.value = "";
  };

  return (
    <section class="panel maps-panel" data-testid="maps-panel">
      <h2>Maps</h2>
      <ul class="map-list">
        {table.maps.map((m) => (
          <li key={m.id} class={m.id === table.activeMapId ? "is-active" : ""} data-map-id={m.id}>
            <button
              type="button"
              class="map-activate"
              title="Show this map to everyone"
              onClick={() => app.send({ type: "map.activate", mapId: m.id })}
            >
              {m.name}
            </button>
            <button
              type="button"
              class="map-delete icon"
              title="Delete map"
              onClick={() => {
                if (globalThis.confirm?.(`Delete map "${m.name}" and its tokens?`) ?? true) {
                  app.send({ type: "map.delete", mapId: m.id });
                }
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form class="inline-form" onSubmit={create}>
        <input name="mapName" placeholder="New map name" maxLength={LIMITS.nameLength} />
        <button type="submit">Add map</button>
      </form>
      {active && <ActiveMapSettings app={app} map={active} />}
    </section>
  );
}

/** Choices offered for splitting cells (n x n sub-cells). */
const SPLIT_OPTIONS = [1, 2, 3, 4, 5];

function formatFeet(feet: number): string {
  return `${Number(feet.toFixed(2))} ft`;
}

function ActiveMapSettings({ app, map }: { app: Controller; map: TableMap }) {
  const grid = (patch: Record<string, number | string | boolean>) => app.send({ type: "map.setGrid", mapId: map.id, grid: patch });
  const { cellSize, offset, gridCells, feetPerCell, subdivisions } = LIMITS;
  const square = map.grid.cellWidth === map.grid.cellHeight;
  return (
    <div class="active-map" data-testid="active-map">
      <TextField label="Name" name="activeMapName" value={map.name} onCommit={(name) => app.send({ type: "map.rename", mapId: map.id, name })} />
      <ImagePicker
        label="Background image"
        name="background"
        onPick={async (file) => {
          const ref = await app.upload(file);
          if (ref) app.send({ type: "map.setBackground", mapId: map.id, image: ref.hash });
        }}
      />
      {map.background && (
        <button type="button" onClick={() => app.send({ type: "map.setBackground", mapId: map.id, image: null })}>
          Remove background
        </button>
      )}
      <p class="hint" data-testid="grid-hint">
        {map.width} × {map.height} px · 1 cell = {formatFeet(map.grid.feetPerCell)}
        {map.grid.subdivisions > 1 && ` · 1 sub-cell = ${formatFeet(subCellFeet(map.grid))}`}
      </p>
      <fieldset class="grid-settings">
        <legend>Grid</legend>
        <label class="field field-check">
          <input type="checkbox" name="gridVisible" checked={map.grid.visible} onChange={(e) => grid({ visible: (e.currentTarget as HTMLInputElement).checked })} />
          <span>Show grid</span>
        </label>
        <button type="button" class="calibrate-start" onClick={() => app.setTool("calibrate")}>
          Set grid from one cell (2 clicks)
        </button>
        <div class="row">
          <NumberField
            label="Cell width (px)"
            name="cellWidth"
            decimals={4}
            value={map.grid.cellWidth}
            min={cellSize.min}
            max={cellSize.max}
            // Square cells stay square when the width is edited; edit the height afterwards for non-square cells.
            onCommit={(v) => grid(square ? { cellWidth: v, cellHeight: v } : { cellWidth: v })}
          />
          <NumberField label="Cell height (px)" name="cellHeight" decimals={4} value={map.grid.cellHeight} min={cellSize.min} max={cellSize.max} onCommit={(v) => grid({ cellHeight: v })} />
        </div>
        <div class="row">
          <NumberField label="Offset X (px)" name="offsetX" decimals={4} value={map.grid.offsetX} min={offset.min} max={offset.max} onCommit={(v) => grid({ offsetX: v })} />
          <NumberField label="Offset Y (px)" name="offsetY" decimals={4} value={map.grid.offsetY} min={offset.min} max={offset.max} onCommit={(v) => grid({ offsetY: v })} />
        </div>
        <NumberField label="Feet per cell" name="feetPerCell" decimals={2} value={map.grid.feetPerCell} min={feetPerCell.min} max={feetPerCell.max} onCommit={(v) => grid({ feetPerCell: v })} />
        <label class="field">
          <span>Split each cell</span>
          <select
            name="subdivisions"
            value={String(map.grid.subdivisions)}
            onChange={(e) => grid({ subdivisions: Number((e.currentTarget as HTMLSelectElement).value) })}
          >
            {SPLIT_OPTIONS.filter((n) => n <= subdivisions.max || n === map.grid.subdivisions).map((n) => (
              <option key={n} value={String(n)}>
                {n === 1 ? "No split" : `${n} × ${n} (${n * n} sub-cells)`}
              </option>
            ))}
          </select>
        </label>
        <SizeSelect label="Default token size" name="defaultTokenSize" value={map.grid.defaultTokenSize} onCommit={(v) => v !== null && grid({ defaultTokenSize: v })} />
        <div class="row">
          <NumberField label="Columns" name="cols" value={map.grid.cols} min={gridCells.min} max={gridCells.max} onCommit={(v) => grid({ cols: v })} />
          <NumberField label="Rows" name="rows" value={map.grid.rows} min={gridCells.min} max={gridCells.max} onCommit={(v) => grid({ rows: v })} />
        </div>
        <ColorField label="Line colour" name="gridColor" value={map.grid.color} onCommit={(v) => grid({ color: v })} />
        <label class="field">
          <span>Opacity</span>
          <input
            type="range"
            name="gridOpacity"
            min={0}
            max={1}
            step={0.05}
            value={map.grid.opacity}
            onChange={(e) => grid({ opacity: Number((e.currentTarget as HTMLInputElement).value) })}
          />
        </label>
      </fieldset>
    </div>
  );
}
