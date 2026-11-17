/** The template library ("monster / character models") and the blank-token tool. */
import { LIMITS } from "../../shared/validate.ts";
import type { Controller } from "../controller.ts";
import { type ClientState, currentMap } from "../store.ts";

export function TemplatesPanel({ app, state }: { app: Controller; state: ClientState }) {
  const table = state.table;
  if (!table) return null;
  const hasMap = currentMap(state) !== null;
  const placingId = state.placing && "templateId" in state.placing ? state.placing.templateId : null;
  const placingBlank = !!state.placing && "blank" in state.placing;

  const create = (e: Event) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("templateName") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    app.send({ type: "template.create", name });
    input.value = "";
  };

  return (
    <section class="panel templates-panel" data-testid="templates-panel">
      <h2>Templates</h2>
      <button
        type="button"
        class={`place-blank ${placingBlank ? "is-on" : ""}`}
        disabled={!hasMap}
        onClick={() => app.setPlacing(placingBlank ? null : { blank: true })}
      >
        {placingBlank ? "Click on the map…" : "Place blank token"}
      </button>
      <ul class="template-list">
        {table.templates.map((t) => (
          <li key={t.id} data-template-id={t.id}>
            <span class="swatch" style={{ background: t.color }} />
            <button type="button" class="template-open" title="Edit template" onClick={() => app.select({ kind: "template", id: t.id })}>
              {t.stats.name}
              {t.unique && <span class="unique-mark" title="Unique: edits to its tokens also update it"> ◆</span>}
            </button>
            <button
              type="button"
              class={`template-place ${placingId === t.id ? "is-on" : ""}`}
              disabled={!hasMap}
              title="Click, then click on the map (hold Shift to place several)"
              onClick={() => app.setPlacing(placingId === t.id ? null : { templateId: t.id })}
            >
              {placingId === t.id ? "…" : "Place"}
            </button>
          </li>
        ))}
      </ul>
      <form class="inline-form" onSubmit={create}>
        <input name="templateName" placeholder="New template, e.g. Goblin" maxLength={LIMITS.nameLength} />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}
