/**
 * D&D 5e stat sheet, for a token or a template. Each edit is sent to the
 * server as a small patch (`token.update` / `template.update`).
 */
import { canControl, isOwner } from "../../shared/permissions.ts";
import type { AppearancePatch } from "../../shared/protocol.ts";
import { ABILITY_LABELS, abilityModifier, CONDITIONS, formatModifier, type StatsPatch } from "../../shared/stats.ts";
import { ABILITIES, type Token, type TokenTemplate } from "../../shared/types.ts";
import { LIMITS } from "../../shared/validate.ts";
import type { Controller } from "../controller.ts";
import { type ClientState, currentMap, type Selection } from "../store.ts";
import { ColorField, ImagePicker, NotesField, NumberField, TextField } from "./fields.tsx";
import { ControlEditor } from "./ControlEditor.tsx";
import { SizeSelect } from "./SizeSelect.tsx";

interface Props {
  app: Controller;
  state: ClientState;
  selection: Selection;
}

export function StatSheet({ app, state, selection }: Props) {
  const table = state.table;
  const item: Token | TokenTemplate | undefined =
    selection.kind === "token" ? table?.tokens.find((t) => t.id === selection.id) : table?.templates.find((t) => t.id === selection.id);
  if (!item) return null;
  const owner = isOwner(state.me);
  // Players only open the sheets of tokens they control (and never templates).
  if (!owner && (selection.kind === "template" || !canControl(state.me, item as Token))) return null;

  const update = (changes: AppearancePatch) =>
    selection.kind === "token"
      ? app.send({ type: "token.update", tokenId: item.id, changes })
      : app.send({ type: "template.update", templateId: item.id, changes });
  const stats = (patch: StatsPatch) => update({ stats: patch });
  const s = item.stats;
  const { stat, bonus, score } = LIMITS;
  // Tokens follow their map's default size; templates follow the map being viewed.
  const mapId = selection.kind === "token" ? (item as Token).mapId : currentMap(state)?.id;
  const defaultSize = table?.maps.find((m) => m.id === mapId)?.grid.defaultTokenSize ?? 1;
  // A unique template and its tokens are linked (the owner sees which template).
  const linkedTemplate =
    selection.kind === "token"
      ? table?.templates.find((t) => t.id === (item as Token).templateId && t.unique)
      : (item as TokenTemplate).unique
        ? (item as TokenTemplate)
        : undefined;
  const linkedTokens = linkedTemplate ? (table?.tokens.filter((t) => t.templateId === linkedTemplate.id).length ?? 0) : 0;

  return (
    <aside class="panel stat-sheet" data-testid="stat-sheet" data-kind={selection.kind} key={`${selection.kind}-${item.id}`}>
      <header class="sheet-header">
        <h2>{selection.kind === "token" ? "Token" : "Template"}</h2>
        <button type="button" class="icon" title="Close" onClick={() => app.select(null)}>
          ✕
        </button>
      </header>

      {selection.kind === "template" && (
        <label class="field field-check unique-toggle" title="The template and all its tokens share every change (positions excepted)">
          <input
            type="checkbox"
            name="unique"
            checked={(item as TokenTemplate).unique}
            onChange={(e) => app.send({ type: "template.update", templateId: item.id, changes: { unique: (e.currentTarget as HTMLInputElement).checked } })}
          />
          <span>Unique (this template and all its tokens are linked)</span>
        </label>
      )}
      {linkedTemplate && (
        <p class="hint unique-hint" data-testid="unique-hint">
          {selection.kind === "token"
            ? `Unique “${linkedTemplate.stats.name}”: edits also apply to the template and its ${linkedTokens - 1} other token(s).`
            : `Edits also apply to its ${linkedTokens} placed token(s), on every map.`}
        </p>
      )}

      <TextField label="Name" name="name" value={s.name} onCommit={(name) => stats({ name })} />

      <div class="row">
        <NumberField label="AC" name="ac" value={s.ac} min={stat.min} max={stat.max} onCommit={(ac) => stats({ ac })} />
        <NumberField label="Speed (ft)" name="speed" value={s.speed} min={0} max={stat.max} onCommit={(speed) => stats({ speed })} />
      </div>

      <div class="row">
        <NumberField label="HP" name="hpCurrent" value={s.hp.current} min={stat.min} max={stat.max} onCommit={(current) => stats({ hp: { current } })} />
        <NumberField label="Max HP" name="hpMax" value={s.hp.max} min={0} max={stat.max} onCommit={(max) => stats({ hp: { max } })} />
        <NumberField label="Temp HP" name="hpTemp" value={s.hp.temp} min={0} max={stat.max} onCommit={(temp) => stats({ hp: { temp } })} />
      </div>

      <div class="abilities">
        {ABILITIES.map((a) => (
          <div class="ability" key={a} data-ability={a}>
            <NumberField
              label={ABILITY_LABELS[a]}
              name={`ability-${a}`}
              value={s.abilities[a]}
              min={score.min}
              max={score.max}
              onCommit={(v) => stats({ abilities: { [a]: v } })}
            />
            <output class="modifier">{formatModifier(abilityModifier(s.abilities[a]))}</output>
          </div>
        ))}
      </div>

      <div class="row">
        <NumberField label="Proficiency" name="proficiencyBonus" value={s.proficiencyBonus} min={bonus.min} max={bonus.max} onCommit={(proficiencyBonus) => stats({ proficiencyBonus })} />
        <NumberField label="Initiative" name="initiativeBonus" value={s.initiativeBonus} min={bonus.min} max={bonus.max} onCommit={(initiativeBonus) => stats({ initiativeBonus })} />
      </div>

      <fieldset class="conditions">
        <legend>Conditions</legend>
        {CONDITIONS.map((c) => (
          <label key={c} class="condition">
            <input
              type="checkbox"
              name={`condition-${c}`}
              checked={s.conditions.includes(c)}
              onChange={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                stats({ conditions: on ? [...s.conditions, c] : s.conditions.filter((x) => x !== c) });
              }}
            />
            {c}
          </label>
        ))}
      </fieldset>

      <NotesField label="Notes" name="notes" value={s.notes} onCommit={(notes) => stats({ notes })} />

      <fieldset class="appearance">
        <legend>Appearance</legend>
        <div class="row">
          <SizeSelect label="Size" name="size" value={item.size} defaultSize={defaultSize} onCommit={(size) => update({ size })} />
          <ColorField label="Colour" name="color" value={item.color} onCommit={(color) => update({ color })} />
        </div>
        <ImagePicker
          label="Image"
          name="image"
          onPick={async (file) => {
            const ref = await app.upload(file);
            if (ref) update({ image: ref.hash });
          }}
        />
        {item.image && (
          <button type="button" onClick={() => update({ image: null })}>
            Remove image
          </button>
        )}
      </fieldset>

      {owner && <ControlEditor control={item.control} users={state.users} onCommit={(control) => update({ control })} />}

      {owner && <footer class="sheet-actions">
        {selection.kind === "token" ? (
          <>
            <button type="button" class="token-duplicate" onClick={() => app.send({ type: "token.duplicate", tokenId: item.id })}>
              Duplicate
            </button>
            <button type="button" class="token-to-template" onClick={() => app.send({ type: "template.create", name: s.name, fromTokenId: item.id })}>
              Save as template
            </button>
            <button type="button" class="danger token-delete" onClick={() => app.send({ type: "token.delete", tokenId: item.id })}>
              Delete token
            </button>
          </>
        ) : (
          <button type="button" class="danger template-delete" onClick={() => app.send({ type: "template.delete", templateId: item.id })}>
            Delete template
          </button>
        )}
      </footer>}
    </aside>
  );
}
