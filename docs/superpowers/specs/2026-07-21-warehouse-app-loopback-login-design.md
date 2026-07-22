# Warehouse App — Desktop Loopback OIDC Login (Phase 1a) Design

**Date:** 2026-07-21
**Branch:** `docs/warehouse-native-app-design`
**Depends on:** Phase 0 foundation (`docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md`, `docs/superpowers/plans/2026-07-20-warehouse-app-phase-0.md`)

## Goal

Make a **real end-to-end OIDC login work on the Linux dev box**: from the Diagnostics screen, click **Login** → the system browser opens the real `auth-web` login page → after the user authenticates, the browser is redirected to a local loopback listener → the app exchanges the authorization code for tokens at `user-service /oauth/token` → tokens are persisted in stronghold → a follow-up `/oauth/userinfo` call returns `200` with the user's claims.

**Success criterion:** on this Linux box, `npx tauri dev` → Login → real credentials → the Diagnostics `status` area shows `userinfo` (`sub`/`email`). No Android, no business workflows.

## Backend context (already exists, not built here)

`user-service` is a spec-aware OIDC provider; `auth-web` (separate `lcnine-auth` deployment) hosts the interactive `/oauth/authorize` UI.

- **Discovery / token / userinfo (user-service):** `.well-known/openid-configuration`, `.well-known/jwks.json`, `POST /oauth/token` (`authorization_code` | `refresh_token`), `GET /oauth/userinfo` (Bearer), `POST /oauth/revoke`, `/oauth/end_session`.
- **Authorize (auth-web):** interactive `/oauth/authorize`; after login it calls user-service `POST /oauth/internal/issue-code` to mint the code, then redirects to the client's `redirect_uri` with `?code&state`.
- **Client model — `oauth_clients` table is SoT:** `clientType` ∈ {`confidential`, `public`}; `public` = PKCE-only, no secret. `redirectUris: string[]`, `allowedScopes: string[]`. Managed via the admin `POST /admin/oauth-clients` API (also surfaced in admin-web).
- **PKCE:** `oauth_authorization_codes.codeChallenge` / `codeChallengeMethod` (S256) — enforced.
- **Redirect matching (`apps/user-service/src/api/oauth/redirect-uri.ts`, RFC 8252):**
  - `confidential` → exact match only.
  - `public` + **loopback** (`127.0.0.1` / `localhost` / `::1`, `http:`) → match on scheme+host+path, **any port allowed**.
  - `public` + custom scheme → exact match only.
- **`warehouse-app` / `almondwms` is not registered anywhere yet** — registration is a prerequisite of this work.

## Approach decision: loopback redirect (RFC 8252 §7.3)

Two callback strategies were considered for desktop:

- **A. Loopback (chosen):** `redirect_uri = http://127.0.0.1:{ephemeral-port}/callback`. The app runs a transient local HTTP listener to receive the callback. The backend already allows any port for loopback public clients, registration passes the admin `@IsUrl` validation cleanly, and it needs **no OS scheme registration and no single-instance plugin**.
- **B. Custom scheme `almondwms://` (rejected for desktop):** reuses the already-coded deep-link path but needs OS scheme registration + `tauri-plugin-single-instance` + fiddly `tauri dev` handoff, and a custom-scheme `redirect_uri` likely fails the admin `@IsUrl` validation (would need a DB seed).

Rationale: RFC 8252 (BCP 212, "OAuth 2.0 for Native Apps") recommends the loopback interface for desktop native apps precisely because the browser and app share the machine. Security rests on PKCE (a leaked code is useless without the original `code_verifier`), loopback-only binding, an ephemeral port, the `state` check, a one-shot listener, and a short timeout. The system browser (not an embedded webview) is used, per RFC 8252 §8.12 — already true via the `opener` plugin. The existing deep-link code is **retained** for the future Android phase; only desktop uses loopback.

## Architecture / flow

```
Diagnostics[Login] ─▶ login.ts (desktop loopback flow)
  1. invoke oauth_loopback_start        ─▶ Rust: bind 127.0.0.1:0 → { port }
  2. redirectUri = `http://127.0.0.1:${port}/callback`
  3. discover(issuer, getJson)          ─▶ user-service /.well-known/openid-configuration   [plugin-http]
  4. url = buildAuthorizeUrl({ ...oidcConfig, redirectUri }, { state, nonce, challenge })
  5. openUrl(url)                        ─▶ system browser → auth-web login
        browser 302 ─▶ http://127.0.0.1:${port}/callback?code&state
  6. invoke oauth_loopback_wait(port)   ─▶ Rust: parse one request → { code, state }; respond "close this tab"
  7. assert returned state === state (CSRF)
  8. exchangeCode({ tokenEndpoint, code, verifier, redirectUri })  ─▶ /oauth/token           [plugin-http]
  9. manager.set(tokens)                ─▶ stronghold vault
 10. apiClient.request(userinfo) with access token ─▶ 200 claims  (shown in Diagnostics status)
```

## Components

### 1. Rust loopback listener (new) — `src-tauri/src/oauth_loopback/mod.rs`
- **Commands (2):**
  - `#[tauri::command] async fn oauth_loopback_start(state) -> Result<{ port: u16 }, String>` — bind `TcpListener` on `127.0.0.1:0`, read the assigned port, spawn a background task that accepts exactly one connection and sends the parsed result over a `oneshot` channel; store the `oneshot::Receiver` in Tauri managed state keyed by port.
  - `#[tauri::command] async fn oauth_loopback_wait(state, port: u16) -> Result<{ code: String, state: String }, String>` — take the receiver for `port`, await it with a **120s timeout**, return the parsed `{code, state}` or an error.
- **Pure, unit-tested helper:** `parse_callback_request_line(line: &str) -> Result<(code, state), String>` — parse `GET /callback?code=..&state=.. HTTP/1.1`. Tested like `parse_target` (Phase 0 Task 9).
- **Security:** bind to `127.0.0.1` only (never `0.0.0.0`); one-shot; timeout; respond with a small HTML page ("Login complete — you can close this tab"); handle/query-decode errors → `Err`.
- **Registration:** `mod oauth_loopback;` + `.manage(...)` for the port→receiver map + `.invoke_handler(tauri::generate_handler![oauth_loopback_start, oauth_loopback_wait])` in `lib.rs`. No capability entry needed (app-defined commands are not ACL-gated in Tauri v2).
- **Implementation choice:** hand-rolled (~50 lines, zero new deps, parse logic unit-testable), matching the project's minimal-dep / TDD ethos and the hand-rolled `print_raw` precedent — rather than `tauri-plugin-oauth`.

### 2. `login.ts` rewiring
- Rewrite `login()` to the desktop loopback flow above (steps 1–9), using `invoke` for the two Rust commands.
- **`exchangeCode` signature change:** replace the internal `oidcConfig.redirectUri` read with a required `redirectUri` parameter (OAuth requires the token-exchange `redirect_uri` to equal the one sent to `/authorize`). Update the one `exchangeCode` unit test in `login.test.ts` accordingly. The tested exchange logic itself is unchanged.
- **Retain the deep-link path:** keep the existing `onOpenUrl`-based callback wait as a separate function for the future Android phase; do not delete it.
- `config.ts`: the static `redirectUri: 'almondwms://oauth/callback'` remains as the Android/custom-scheme default; the desktop flow computes its `redirectUri` dynamically from the listener port.

### 3. Stronghold password hashing (in scope — required)
- Login persists tokens via `createStrongholdTokenStore`, so the `lib.rs` stronghold init `|pass| todo!()` **must** be replaced with an argon2id `hash_raw(pass, salt, &config)` returning the key bytes; add the `rust-argon2` crate (imported as `argon2`). Without this, `TokenStore.save()` panics on first use.
- The vault password stays the Phase 0 static placeholder (`'almondwms'` from `tokenStore.ts`) with a static salt — a known, already-documented hardening deferral (device-derived key is a later phase).

### 4. UI entry point — `DiagnosticsScreen`
- Add a **Login** button and a `status` display. On click it assembles `createStrongholdTokenStore` → `createTokenManager({ store, refresh })` → `login({ manager })`, then calls `/oauth/userinfo` via `createApiClient` with the access token and renders the claims (`sub`/`email`) on success, or the error on failure.

### 5. Backend / config prerequisites (operator-provided; guided here)
- **Register the client** in `oauth_clients`: `clientId=warehouse-app`, `clientType=public`, `redirectUris=["http://127.0.0.1/callback"]`, `allowedScopes=["openid","profile","email","offline_access"]` (via admin `POST /admin/oauth-clients`).
- **`native/warehouse-app/.env.local`:** `VITE_OIDC_ISSUER` (user-service base URL), `VITE_OIDC_AUTHORIZE` (auth-web `/oauth/authorize`), `VITE_OIDC_CLIENT_ID=warehouse-app`, `VITE_API_BASE_URL`.
- **capabilities http scope:** add the issuer host (and API host) to the `http:default` scope in `src-tauri/capabilities/default.json` so `plugin-http` may fetch discovery / token / userinfo.

## Testing / verification

- **Rust unit:** `parse_callback_request_line` (valid, missing params, `error=` param, malformed line).
- **TS unit:** update the `exchangeCode` test for the new `redirectUri` param; the whole Vitest suite stays green.
- **End-to-end (manual, this box):** with the client registered, `.env.local` set, and http scope configured — `npx tauri dev` → Login → real auth-web login → Diagnostics `status` shows `userinfo` `200` (`sub`/`email`).

## Out of scope (later phases)

Android deep-link / intent-filter login, the updater, per-install stronghold salt hardening, automatic silent-refresh UI, token-backed business workflows, `spooler://` Windows printing.
