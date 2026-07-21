# Warehouse App — Login Screen + Route Guard (TanStack Router) Design

**Date:** 2026-07-22
**Branch:** `docs/warehouse-native-app-design`
**Depends on:** Phase 1a loopback login (`docs/superpowers/specs/2026-07-21-warehouse-app-loopback-login-design.md`) — a real end-to-end login (loopback OIDC → `userinfo` 200) is confirmed working on the dev box.

## Goal

Give the app a real entry point: an **initial login screen** and an **authenticated area gated by a route guard**, built on **TanStack Router** (the app's first router). On launch the app silently restores a persisted session when possible; otherwise it shows the login screen. Once authenticated, the user lands on their profile's home; a logout returns them to the login screen.

**Success criterion:** cold start with no stored session → login screen → Login → land on the profile home; restart with a stored valid session → land on the profile home **without** re-entering credentials; logout → back to the login screen; navigating to a protected route while unauthenticated → redirected to the login screen.

## Current state (what exists, what this changes)

- **No router today.** `src/main.tsx` resolves the profile synchronously (`resolveProfile(platform())`) and renders a single `StationHome` / `HandheldHome` under `<App>`, wrapped in `QueryClientProvider` + `ScanProvider`. There is no navigation and no auth gate.
- **Auth is not app-global.** `createTokenManager` (`core/auth/tokenManager.ts`) and `createStrongholdTokenStore` (`core/auth/tokenStore.ts`) are instantiated **ad hoc inside `DiagnosticsScreen.onLogin()`** on every button click. Nothing reads a shared session.
- **No startup session bootstrap.** The stronghold vault persists the refresh token across restarts, but nothing attempts to restore a session on launch.
- **Login mechanics are done.** `loginWithLoopback({ manager, onStep })`, `refreshTokens`, `discoverEndpoints` (`core/auth/login.ts`), `createApiClient({ baseUrl, getToken, authMode })` (`core/data/httpClient.ts`), and `oidcConfig` (`app/config.ts`) all work.

This work **lifts auth state to an app-global session**, adds the **router + guard + login screen + splash bootstrap**, and **absorbs the ad-hoc login logic** out of `DiagnosticsScreen`.

## Scope decisions (agreed)

1. **Depth — routing skeleton, not future screens.** Build the router backbone (public `/login`, an authenticated layout with the guard, profile home, `/diagnostics`) so Phase 1–4 screens later slot in as child routes. Do **not** scaffold those future screens now (YAGNI).
2. **Session restore — silent auto-login.** On launch, restore a persisted valid session (refreshing an expired access token if needed) and skip the login screen. Show `/login` only when there is no valid session. Explicit **logout** is in scope to cover shared-station handoff.
3. **Login round-trip is verified** (both unit tests and on-device `tauri dev` → `userinfo` 200), so the guard is built on confirmed login mechanics.

## Routing technology decisions

- **Route definition: code-based** (`createRootRoute` / `createRoute` / `createRouter`). File-based routing would add `@tanstack/router-plugin` + a route-tree codegen step to the standalone project's Vite build — unjustified for a tree this small. (Alternative considered: file-based; better DX at the cost of build-pipeline weight. Rejected for now.)
- **History: memory history** (`createMemoryHistory`). This is a native app — the URL is never user-visible and no shareable/deep links to routes are needed in v1. Browser history risks an `index.html` 404 on sub-route reload under the production custom protocol; hash history is noisy. Memory history sidesteps both. (Android's hardware back button is deferred to the handheld phase.)
- **Dependency added:** `@tanstack/react-router` only (no devtools/plugin). Standalone `package.json` / `package-lock.json`.

## Architecture

### Session — app-global, framework-agnostic

`core/auth/session.ts` exports `createSession(deps)`, a **pure, unit-testable factory** in the same spirit as `createTokenManager` (no React, no router). It wraps a single `TokenManager` and owns the authenticated/unauthenticated state:

```ts
createSession(deps: {
  manager: ReturnType<typeof createTokenManager>;
  // side-effecting login runner, injected for testability; wraps
  // loginWithLoopback({ manager, onStep }) in production.
  runLogin: (manager, onStep?: (s: string) => void) => Promise<void>;
}) => {
  bootstrap(): Promise<void>;        // restore persisted session once at startup
  isAuthenticated(): boolean;        // synchronous — read by the guard
  getAccessToken(): Promise<string>; // for the API client
  login(onStep?): Promise<void>;     // deps.runLogin(manager, onStep) → authenticated
  logout(): Promise<void>;           // manager.clear() → unauthenticated
  subscribe(fn: () => void): () => void; // notify React on state change
}
```

- **`bootstrap()`**: call `manager.getAccessToken()`; success → authenticated, a thrown `"not authenticated"` / refresh failure → unauthenticated. This transparently refreshes an expired access token from the stored refresh token (silent auto-login) and treats any failure as "logged out". Runs exactly once at startup.
- **State transitions**: `login()` → authenticated; `logout()` and any bootstrap/refresh failure → unauthenticated. `subscribe` drives a small React adapter (`useSyncExternalStore` or context) so the guard/screens re-render on change.

`app/` wires the single session instance into both a **React context** (for screens: `session.login`, `session.logout`, status) and the **TanStack Router `context`** (for `beforeLoad` guards).

### Route tree

```
__root  — renders <App> shell + <Outlet/>; router context = { session }
├─ /login          — public. beforeLoad: if isAuthenticated() → redirect({ to: '/' })
└─ _authed         — pathless layout. beforeLoad: if !isAuthenticated() → redirect({ to: '/login' })
   ├─ /            — index: profile home (StationHome | HandheldHome via resolveProfile)
   └─ /diagnostics — DiagnosticsScreen (hardware harness + session status + logout)
   (Phase 1–4 screens attach here later as children of _authed)
```

- **Guard** lives in `_authed.beforeLoad({ context })`: `if (!context.session.isAuthenticated()) throw redirect({ to: '/login' })`.
- **Reverse guard** on `/login.beforeLoad`: already-authenticated users are bounced to `/`.
- The profile (`station` / `handheld`) is resolved once (`resolveProfile(platform())`, override-aware) and selects the index home component; it is **not** a route param. The router's job here is auth-gating + the future in-profile navigation, not profile switching.

### Startup / splash bootstrap

Because silent auto-login is async (stronghold load + possible network refresh), the bootstrap runs **once before the router mounts**, behind a splash. `beforeLoad` then only reads the already-resolved synchronous `isAuthenticated()` — no network on navigation.

```
main.tsx:
  session = createSession(...)                       // over stronghold store + tokenManager
  render <Bootstrap session>                          // shows a splash
    → await session.bootstrap()
    → then render <RouterProvider router={router} context={{ session }} />
  (QueryClientProvider + ScanProvider stay as outer providers)
```

(Alternative considered: run bootstrap inside the root route's `beforeLoad` with a `pendingComponent` splash. More "router-native", but gating the network refresh to a single run is fiddly; the pre-mount React gate is simpler. Rejected.)

### Login screen

Actual credential entry happens in the **system browser** (loopback OIDC), so the in-app screen is only a **trigger + progress/error surface**:

- "Almond WMS" branding + a **Login** button → `session.login(onStep)`.
- Reuses the existing `loginWithLoopback` `onStep` progress (`1/6 …`) and error text.
- Location: `app/routes/LoginScreen.tsx` (profile-agnostic).

### Logout & 401 handling

- **Logout**: a button in `DiagnosticsScreen` (and, if useful, the `<App>` shell header) → `session.logout()` → state change → the guard redirects to `/login`.
- **Session invalidation**: at **startup**, `bootstrap()` maps any `getAccessToken()` failure (no token, or a rejected refresh) to unauthenticated → guard shows `/login`. **Mid-session**, `session.getAccessToken()` is a bare delegate: a refresh failure surfaces the error to the caller but does **not** auto-flip the session in v1 — routing an in-session 401/refresh-failure back to `/login` is part of the deferred data-layer "401 → force logout" policy (see Out of scope). (This is dormant in v1: no post-bootstrap code calls `session.getAccessToken()` yet.) OIDC `end_session` is deferred.
- **API 401 with a valid-looking token** (backend rejects, e.g. the `warehouse` role isn't accepted yet): v1 **surfaces it as an error message** and does not force a logout, to avoid a login loop. A global "401 → force logout" policy is deferred to a data-layer enhancement.

### `DiagnosticsScreen` refactor

Remove the ad-hoc `createStrongholdTokenStore` / `createTokenManager` / `loginWithLoopback` wiring from `onLogin`. Diagnostics keeps its hardware harness (scan list, camera scan, test print) and gains a **session-status line + Logout button** that read the shared session from context. It becomes the `/diagnostics` route. The route wrapper (`DiagnosticsRoute`) also renders a **back-to-home `<Link to="/">`** so `/diagnostics` is not a dead-end (the profile home has no other return path, and the station profile has no hardware back button).

## Testing

- **`createSession` (Vitest unit)**: bootstrap restores an authenticated session when the store/refresh succeed; bootstrap yields unauthenticated when the store is empty or refresh fails; `login()` → authenticated; `logout()` → unauthenticated; `subscribe` fires on transition. Uses a fake `TokenStore` + fake `refresh` (same style as the existing `tokenManager` / `login` tests).
- **Guard logic**: unauthenticated access to a protected route redirects to `/login`; authenticated access to `/login` redirects to `/`. Test the `beforeLoad` decision (pure, against a stub session) — router integration kept light.
- **LoginScreen (Testing Library)**: renders the Login button; clicking it calls `session.login`; progress/error text renders from `onStep` / a thrown error.
- Full Vitest suite stays green; `tsc -b` clean. No `any` / `as` without justification.

## Out of scope (later phases)

Phase 1–4 business screens (inbound / pick / inventory / packing) · Android hardware back-button handling · fine-grained scope decomposition · the runtime settings screen (backend/OIDC URL override) · OIDC `end_session` on logout · a global "401 → force logout" data-layer policy · per-install device-derived stronghold key.
