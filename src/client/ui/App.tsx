/** Top-level layout: join form, or header + sidebar + map + stat sheet. */
import { Component } from "preact";
import { isOwner } from "../../shared/permissions.ts";
import { LIMITS } from "../../shared/validate.ts";
import type { Controller } from "../controller.ts";
import { type ClientState, currentMap } from "../store.ts";
import { MapsPanel } from "./MapsPanel.tsx";
import { MapToolbar } from "./MapToolbar.tsx";
import { PlayersPanel } from "./PlayersPanel.tsx";
import { MapView } from "./MapView.tsx";
import { StatSheet } from "./StatSheet.tsx";
import { TemplatesPanel } from "./TemplatesPanel.tsx";

export function App({ app, state }: { app: Controller; state: ClientState }) {
  if (state.name === null) return <JoinForm app={app} notice={state.notice} />;
  const table = state.table;
  // Only the owner configures the table: maps, grid, templates.
  const owner = isOwner(state.me);
  const activeMap = currentMap(state);

  return (
    <div class="app">
      <header class="topbar">
        {/* Outside the sidebar so it stays visible when the sidebar is hidden. */}
        {owner && <button
          type="button"
          class={`sidebar-toggle ${state.sidebarCollapsed ? "" : "is-on"}`}
          data-testid="sidebar-toggle"
          title={state.sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar"}
          aria-label={state.sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar"}
          aria-expanded={!state.sidebarCollapsed}
          onClick={() => app.toggleSidebar()}
        >
          ☰
        </button>}
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
        {owner && !state.sidebarCollapsed && <Sidebar app={app} state={state} />}
        <main class="stage">
          {activeMap ? (
            <>
              <MapView app={app} state={state} map={activeMap} />
              <MapToolbar app={app} state={state} />
            </>
          ) : (
            <p class="empty">
              {!table ? "Loading the table…" : owner ? "No map yet. Create one in the sidebar." : "Waiting for the game master to show a map."}
            </p>
          )}
        </main>
        {state.selection && <StatSheet app={app} state={state} selection={state.selection} />}
      </div>
    </div>
  );
}

/**
 * The sidebar only depends on the table, the tool, placing, the viewed map and
 * the users. Skipping its re-render on other changes (pan, zoom, drag,
 * ruler…) keeps the map smooth.
 */
class Sidebar extends Component<{ app: Controller; state: ClientState }> {
  override shouldComponentUpdate(next: { state: ClientState }): boolean {
    const a = this.props.state;
    const b = next.state;
    return a.table !== b.table || a.tool !== b.tool || a.placing !== b.placing || a.viewMapId !== b.viewMapId || a.users !== b.users;
  }

  render() {
    const { app, state } = this.props;
    return (
      <nav class="sidebar" data-testid="sidebar">
        <MapsPanel app={app} state={state} />
        <PlayersPanel app={app} state={state} />
        <TemplatesPanel app={app} state={state} />
      </nav>
    );
  }
}

function UsersList({ state }: { state: ClientState }) {
  return (
    <ul class="users" data-testid="users" aria-label="Connected users">
      {state.users.map((u) => (
        <li key={u.id} class={`${u.id === state.me?.id ? "is-me" : ""} ${u.role === "owner" ? "is-owner" : ""}`}>
          {u.name}
          {u.role === "owner" && <span class="role-badge"> (GM)</span>}
        </li>
      ))}
    </ul>
  );
}

export function JoinForm({ app, notice }: { app: Controller; notice?: string | null }) {
  const submit = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("displayName") as HTMLInputElement).value.trim();
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
    const password = passwordInput.value;
    passwordInput.value = "";
    if (name) app.join(name, password || undefined);
  };
  return (
    <form class="join" data-testid="join" onSubmit={submit}>
      <h1>Malzob</h1>
      {notice && (
        <p class="join-notice" role="alert">
          {notice}
        </p>
      )}
      <label>
        Your display name
        <input name="displayName" required maxLength={LIMITS.nameLength} placeholder="e.g. Jane Doe" autoFocus autoComplete="username" />
      </label>
      <label>
        Owner password <span class="hint">(game master only; players leave it empty)</span>
        <input name="password" type="password" maxLength={LIMITS.passwordLength} autoComplete="current-password" />
      </label>
      <button type="submit">Join the table</button>
    </form>
  );
}
