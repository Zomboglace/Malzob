/** Top-level layout: join form, or header + sidebar + map + stat sheet. */
import { LIMITS } from "../../shared/validate.ts";
import type { Controller } from "../controller.ts";
import type { ClientState } from "../store.ts";
import { MapsPanel } from "./MapsPanel.tsx";
import { MapView } from "./MapView.tsx";
import { StatSheet } from "./StatSheet.tsx";
import { TemplatesPanel } from "./TemplatesPanel.tsx";

export function App({ app, state }: { app: Controller; state: ClientState }) {
  if (state.name === null) return <JoinForm app={app} />;
  const table = state.table;
  const activeMap = table?.maps.find((m) => m.id === table.activeMapId) ?? null;

  return (
    <div class="app">
      <header class="topbar">
        <h1>Malzob</h1>
        <span class={`status status-${state.connection}`} data-testid="status">
          {state.connection === "open" ? "Connected" : state.connection === "connecting" ? "Connecting…" : "Disconnected — retrying"}
        </span>
        <UsersList state={state} />
      </header>
      {state.notice && (
        <div class="notice" role="alert" data-testid="notice">
          {state.notice}
          <button type="button" class="icon" onClick={() => app.notify(null)}>
            ✕
          </button>
        </div>
      )}
      <div class="layout">
        <nav class="sidebar">
          <MapsPanel app={app} state={state} />
          <TemplatesPanel app={app} state={state} />
        </nav>
        <main class="stage">
          {activeMap ? (
            <MapView app={app} state={state} map={activeMap} />
          ) : (
            <p class="empty">{table ? "No map yet. Create one in the sidebar." : "Loading the table…"}</p>
          )}
        </main>
        {state.selection && <StatSheet app={app} state={state} selection={state.selection} />}
      </div>
    </div>
  );
}

function UsersList({ state }: { state: ClientState }) {
  return (
    <ul class="users" data-testid="users" aria-label="Connected users">
      {state.users.map((u) => (
        <li key={u.id} class={u.id === state.me?.id ? "is-me" : ""}>
          {u.name}
        </li>
      ))}
    </ul>
  );
}

export function JoinForm({ app }: { app: Controller }) {
  const submit = (e: Event) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("displayName") as HTMLInputElement;
    const name = input.value.trim();
    if (name) app.join(name);
  };
  return (
    <form class="join" data-testid="join" onSubmit={submit}>
      <h1>Malzob</h1>
      <label>
        Your display name
        <input name="displayName" required maxLength={LIMITS.nameLength} placeholder="e.g. Jane Doe" autoFocus />
      </label>
      <button type="submit">Join the table</button>
    </form>
  );
}
