/**
 * Owner only: which map each player sees. Players start on the first map;
 * the owner sends each of them to any map, individually.
 */
import { playerKey, playerMapId } from "../../shared/permissions.ts";
import type { Controller } from "../controller.ts";
import type { ClientState } from "../store.ts";

export interface KnownPlayer {
  name: string;
  online: boolean;
  /** The map the player sees (or would see when they join). */
  mapId: string | null;
}

/** Connected players, plus players who were sent to a map earlier and are offline. */
export function knownPlayers(state: ClientState): KnownPlayer[] {
  const table = state.table;
  if (!table) return [];
  const byKey = new Map<string, KnownPlayer>();
  for (const u of state.users) {
    if (u.role !== "player") continue;
    byKey.set(playerKey(u.name), { name: u.name, online: true, mapId: playerMapId(table, u.name) });
  }
  for (const [key, pm] of Object.entries(table.playerMaps)) {
    if (!byKey.has(key)) byKey.set(key, { name: pm.name, online: false, mapId: playerMapId(table, pm.name) });
  }
  return [...byKey.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export function PlayersPanel({ app, state }: { app: Controller; state: ClientState }) {
  const table = state.table;
  if (!table || table.maps.length === 0) return null;
  const players = knownPlayers(state);
  return (
    <section class="panel players-panel" data-testid="players-panel">
      <h2>Players</h2>
      {players.length === 0 ? (
        <p class="hint">No players yet. They start on the first map ({table.maps[0]!.name}).</p>
      ) : (
        <ul class="player-list">
          {players.map((p) => (
            <li key={playerKey(p.name)} data-player={p.name} class={p.online ? "is-online" : "is-offline"}>
              <span class="player-name" title={p.online ? "Connected" : "Not connected"}>
                {p.name}
              </span>
              <select
                name="playerMap"
                aria-label={`Map for ${p.name}`}
                value={p.mapId ?? ""}
                onChange={(e) => app.send({ type: "player.setMap", player: p.name, mapId: (e.currentTarget as HTMLSelectElement).value })}
              >
                {table.maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
