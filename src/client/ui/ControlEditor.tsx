/**
 * Owner-only: who besides the owner may move and edit a token (or the tokens
 * placed from a template). Players are matched by display name.
 */
import { sameName } from "../../shared/permissions.ts";
import type { TokenControl, User } from "../../shared/types.ts";
import { LIMITS } from "../../shared/validate.ts";

interface Props {
  control: TokenControl;
  /** Connected users, offered as one-click choices. */
  users: User[];
  onCommit(control: Partial<TokenControl>): void;
}

export function ControlEditor({ control, users, onCommit }: Props) {
  const setPlayers = (players: string[]) => onCommit({ players });
  const suggestions = users.filter((u) => u.role === "player" && !control.players.some((p) => sameName(p, u.name)));

  const add = (e: Event) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("controlName") as HTMLInputElement;
    const name = input.value.trim();
    input.value = "";
    if (name && !control.players.some((p) => sameName(p, name))) setPlayers([...control.players, name]);
  };

  return (
    <fieldset class="control" data-testid="control">
      <legend>Who can use it</legend>
      <label class="field field-check">
        <input
          type="checkbox"
          name="controlEveryone"
          checked={control.everyone}
          onChange={(e) => onCommit({ everyone: (e.currentTarget as HTMLInputElement).checked })}
        />
        <span>Any player</span>
      </label>
      {control.players.length > 0 && (
        <ul class="control-players">
          {control.players.map((p) => (
            <li key={p} data-player={p}>
              <span>{p}</span>
              <button type="button" class="icon control-remove" title={`Remove ${p}`} onClick={() => setPlayers(control.players.filter((q) => q !== p))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <div class="control-suggestions">
          {suggestions.map((u) => (
            <button key={u.id} type="button" class="control-add-user" onClick={() => setPlayers([...control.players, u.name])}>
              + {u.name}
            </button>
          ))}
        </div>
      )}
      <form class="inline-form" onSubmit={add}>
        <input name="controlName" placeholder="Player name" maxLength={LIMITS.nameLength} />
        <button type="submit">Give control</button>
      </form>
      <p class="hint">Players are recognised by their display name. They can move and edit the token, but not delete it.</p>
    </fieldset>
  );
}
