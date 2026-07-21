# Warehouse App — Desktop Loopback OIDC Login (Phase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a real OIDC login work end-to-end on the Linux dev box — Diagnostics `Login` → system-browser auth-web login → loopback callback → token exchange → stronghold storage → `userinfo` 200.

**Architecture:** RFC 8252 loopback redirect. A small Rust listener binds `127.0.0.1:0`, the system browser is redirected there with the auth code, and the app exchanges the code (with PKCE) at `user-service /oauth/token`. The already-coded deep-link path is retained for the future Android phase; only desktop uses loopback.

**Tech Stack:** Tauri 2 (Rust, `std::net` listener, `tokio` for the wait timeout, `rust-argon2` for the stronghold key), React 19 + TypeScript, `@tauri-apps/plugin-{http,opener,stronghold,os}`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-07-21-warehouse-app-loopback-login-design.md`

## Global Constraints

- **Node** `>=22 <23`. Local is v22.23.1.
- **Standalone project** at `native/warehouse-app/`, own `package-lock.json`, imports no sibling app code.
- **Rust on PATH:** cargo/rustc are installed but not on the session PATH — **prefix every cargo/tauri command with `. "$HOME/.cargo/env" &&`**.
- **No `tauri` npm script exists** — use `npx tauri …`.
- **All backend HTTP goes through `@tauri-apps/plugin-http`** (native reqwest, bypasses CORS). The loopback listener is inbound Rust `std::net` (not plugin-http).
- **Desktop redirect:** `http://127.0.0.1:{ephemeral}/callback` (loopback). App identifier `kr.lcnine.almondwms`. The custom scheme `almondwms://oauth/callback` stays as the Android default in `config.ts`.
- **PKCE S256** (already implemented). System browser only, never an embedded webview (already true via `opener`).
- **TDD** for deterministic logic (the Rust callback parser, the TS `exchangeCode` change). OS/hardware/OAuth-runtime glue is verified by the Diagnostics screen on-device — marked **[manual on-device]**.
- **Commit** after every task. All commits end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** continue on `docs/warehouse-native-app-design`.
- **Prohibited:** `any`/`as` casting without justification; `@Inject('DB')`; do not delete the deep-link login path.

---

## File Structure

```
native/warehouse-app/
├─ src-tauri/
│  ├─ Cargo.toml                       # + tokio, + rust-argon2                (Tasks 1, 2)
│  ├─ src/lib.rs                       # register loopback cmds + argon2 init  (Tasks 1, 2)
│  ├─ src/oauth_loopback/mod.rs        # NEW: listener + parser + 2 commands   (Task 1)
│  └─ capabilities/default.json        # + http scope for issuer/api host      (Task 5)
├─ src/
│  ├─ core/auth/login.ts               # exchangeCode(redirectUri) + loopback  (Task 3)
│  ├─ core/auth/login.test.ts          # exchangeCode test update              (Task 3)
│  └─ profiles/shared/DiagnosticsScreen.tsx        # Login button + userinfo   (Task 4)
│  └─ profiles/shared/DiagnosticsScreen.test.tsx   # assert Login button       (Task 4)
├─ .env.local                          # NEW (gitignored): real dev URLs       (Task 5)
```

---

## Task 1: Rust loopback listener + callback parser

**Files:**
- Modify: `native/warehouse-app/src-tauri/Cargo.toml`
- Create: `native/warehouse-app/src-tauri/src/oauth_loopback/mod.rs`
- Modify: `native/warehouse-app/src-tauri/src/lib.rs`

**Interfaces:**
- Produces (Rust): `parse_callback_request_line(line: &str) -> Result<(String, String), String>` returning `(code, state)`.
- Produces (Tauri commands): `oauth_loopback_start() -> { port: u16 }` and `oauth_loopback_wait(port: u16) -> { code: String, state: String }`.
- Consumed by Task 3 via `invoke('oauth_loopback_start')` / `invoke('oauth_loopback_wait', { port })`.

- [ ] **Step 1: Add the tokio dependency**

In `native/warehouse-app/src-tauri/Cargo.toml`, under `[dependencies]`, add:
```toml
tokio = { version = "1", features = ["time", "sync"] }
```

- [ ] **Step 2: Create the module with the parser stub + tests**

Create `native/warehouse-app/src-tauri/src/oauth_loopback/mod.rs`:
```rust
/// Parse `code` and `state` out of an HTTP request line such as
/// `GET /callback?code=abc&state=xyz HTTP/1.1`. Errors if the OAuth server
/// returned an `error=` param, or if `code`/`state` are missing.
pub fn parse_callback_request_line(line: &str) -> Result<(String, String), String> {
    unimplemented!()
}

fn percent_decode(_s: &str) -> String {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_code_and_state() {
        assert_eq!(
            parse_callback_request_line("GET /callback?code=abc&state=xyz HTTP/1.1").unwrap(),
            ("abc".to_string(), "xyz".to_string())
        );
    }

    #[test]
    fn errors_on_oauth_error_param() {
        assert!(parse_callback_request_line("GET /callback?error=access_denied HTTP/1.1").is_err());
    }

    #[test]
    fn errors_when_code_or_state_missing() {
        assert!(parse_callback_request_line("GET /callback?code=abc HTTP/1.1").is_err());
    }

    #[test]
    fn percent_decodes_values() {
        assert_eq!(
            parse_callback_request_line("GET /callback?code=a%20b&state=x%2By HTTP/1.1").unwrap(),
            ("a b".to_string(), "x+y".to_string())
        );
    }
}
```
Register the module so the crate compiles: in `native/warehouse-app/src-tauri/src/lib.rs`, add as the **first line**:
```rust
mod oauth_loopback;
```

- [ ] **Step 3: Run the Rust tests to verify they fail**

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app/src-tauri && cargo test oauth_loopback 2>&1 | tail -20`
Expected: FAIL — tests panic on `not implemented` / `unimplemented!()`. (Test names are `oauth_loopback::tests::*`; filter on `oauth_loopback`, not `parse_callback`.)

- [ ] **Step 4: Implement the parser**

In `oauth_loopback/mod.rs`, replace the two stub bodies:
```rust
pub fn parse_callback_request_line(line: &str) -> Result<(String, String), String> {
    // request line: METHOD SP request-target SP HTTP-version
    let target = line.split(' ').nth(1).ok_or("malformed request line")?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        let val = percent_decode(v);
        match k {
            "error" => return Err(format!("OAuth error: {val}")),
            "code" => code = Some(val),
            "state" => state = Some(val),
            _ => {}
        }
    }
    match (code, state) {
        (Some(c), Some(s)) => Ok((c, s)),
        _ => Err("callback missing code/state".into()),
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < b.len() => {
                let hi = (b[i + 1] as char).to_digit(16);
                let lo = (b[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
```

- [ ] **Step 5: Run the Rust tests to verify they pass**

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app/src-tauri && cargo test parse_callback 2>&1 | tail -20`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the listener state + the two commands**

Append to `oauth_loopback/mod.rs`:
```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::sync::oneshot;

/// Port → receiver for the single callback that loopback listener will deliver.
#[derive(Default)]
pub struct LoopbackState {
    pending: Mutex<HashMap<u16, oneshot::Receiver<Result<(String, String), String>>>>,
}

#[derive(Serialize)]
pub struct StartResult {
    pub port: u16,
}

#[derive(Serialize)]
pub struct Callback {
    pub code: String,
    pub state: String,
}

/// Bind an ephemeral loopback port and spawn a one-shot listener thread.
#[tauri::command]
pub async fn oauth_loopback_start(
    state: State<'_, LoopbackState>,
) -> Result<StartResult, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel();
    // Blocking accept on a dedicated thread; deliver the parsed result via the channel.
    // If the user abandons login, this thread lingers on accept() until process exit
    // — acceptable for Phase 1a (the command below still times out at 120s).
    std::thread::spawn(move || {
        let _ = tx.send(accept_one(&listener));
    });
    state
        .pending
        .lock()
        .map_err(|_| "loopback state poisoned")?
        .insert(port, rx);
    Ok(StartResult { port })
}

/// Await the callback for `port` (120s timeout).
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: State<'_, LoopbackState>,
    port: u16,
) -> Result<Callback, String> {
    let rx = {
        let mut pending = state.pending.lock().map_err(|_| "loopback state poisoned")?;
        pending
            .remove(&port)
            .ok_or("no pending loopback listener for that port")?
    };
    let received = tokio::time::timeout(Duration::from_secs(120), rx)
        .await
        .map_err(|_| "login timed out".to_string())?
        .map_err(|_| "loopback listener dropped".to_string())?;
    let (code, st) = received?;
    Ok(Callback { code, state: st })
}

/// Accept exactly one connection, parse its request line, and reply with a small page.
fn accept_one(listener: &TcpListener) -> Result<(String, String), String> {
    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(120))).ok();
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let first_line = text.lines().next().unwrap_or("");
    let parsed = parse_callback_request_line(first_line);
    let body = if parsed.is_ok() {
        "<html><body>Login complete — you can close this tab.</body></html>"
    } else {
        "<html><body>Login failed — you can close this tab.</body></html>"
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    parsed
}
```

- [ ] **Step 7: Register state + commands in `lib.rs`**

In `native/warehouse-app/src-tauri/src/lib.rs`, add `.manage(...)` and `.invoke_handler(...)` to the builder chain (place both immediately after `tauri::Builder::default()`):
```rust
    tauri::Builder::default()
        .manage(oauth_loopback::LoopbackState::default())
        .invoke_handler(tauri::generate_handler![
            oauth_loopback::oauth_loopback_start,
            oauth_loopback::oauth_loopback_wait
        ])
        .plugin(tauri_plugin_stronghold::Builder::new(|pass| todo!()).build())
        // ...existing plugins unchanged...
```

- [ ] **Step 8: Build to verify the whole crate compiles**

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app/src-tauri && cargo build 2>&1 | tail -20`
Expected: `Finished` (no errors). First build compiles all Tauri deps and is slow.

- [ ] **Step 9: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src-tauri
git commit -m "feat(warehouse-app): loopback OIDC callback listener (Rust)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Stronghold vault key via argon2 (replace the `todo!()`)

**Files:**
- Modify: `native/warehouse-app/src-tauri/Cargo.toml`
- Modify: `native/warehouse-app/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a working stronghold vault key derivation so `createStrongholdTokenStore().save()` (used in Task 4) does not panic.

- [ ] **Step 1: Add the argon2 dependency**

In `native/warehouse-app/src-tauri/Cargo.toml`, under `[dependencies]`, add (the package is `rust-argon2`; its library is imported as `argon2`):
```toml
rust-argon2 = "2"
```

- [ ] **Step 2: Replace the stronghold init closure**

In `native/warehouse-app/src-tauri/src/lib.rs`, replace this line:
```rust
        .plugin(tauri_plugin_stronghold::Builder::new(|pass| todo!()).build())
```
with:
```rust
        .plugin(
            tauri_plugin_stronghold::Builder::new(|pass| {
                use argon2::{hash_raw, Config, Variant, Version};
                let config = Config {
                    variant: Variant::Argon2id,
                    version: Version::Version13,
                    lanes: 4,
                    mem_cost: 10_000,
                    time_cost: 10,
                    ..Default::default()
                };
                // Phase 0 placeholder static salt — a device-derived key is a later
                // hardening phase (see tokenStore.ts security note).
                let salt = b"almondwms-static-salt";
                hash_raw(pass.as_bytes(), salt, &config).expect("stronghold key hash failed")
            })
            .build(),
        )
```

- [ ] **Step 3: Build to verify it compiles**

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app/src-tauri && cargo build 2>&1 | tail -20`
Expected: `Finished` (no errors).

- [ ] **Step 4: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src-tauri
git commit -m "feat(warehouse-app): argon2id stronghold vault key (replace todo placeholder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `login.ts` — dynamic `redirectUri` + loopback login flow

**Files:**
- Modify: `native/warehouse-app/src/core/auth/login.ts`
- Modify: `native/warehouse-app/src/core/auth/login.test.ts`

**Interfaces:**
- Consumes: `oauth_loopback_start` / `oauth_loopback_wait` (Task 1); `discover`, `buildAuthorizeUrl` (oidc.ts); `generatePkce`, `randomUrlSafe` (pkce.ts); `createTokenManager` (tokenManager.ts).
- Produces:
  - `exchangeCode(p: { tokenEndpoint; code; verifier; redirectUri: string; now? }): Promise<TokenSet>` — now takes `redirectUri`.
  - `discoverEndpoints(): Promise<OidcEndpoints>`.
  - `loginWithLoopback(deps: { manager }): Promise<void>` — desktop flow.
  - `loginWithDeepLink(deps: { manager }): Promise<void>` — the old flow, retained for Android.

- [ ] **Step 1: Update the exchangeCode test (make it require `redirectUri`)**

In `native/warehouse-app/src/core/auth/login.test.ts`, replace the `exchangeCode` test body with:
```ts
describe('exchangeCode', () => {
  it('sends the given redirect_uri and maps the token response', async () => {
    const t0 = 1_000_000;
    const set = await exchangeCode({
      tokenEndpoint: 'https://a/token',
      code: 'CODE',
      verifier: 'V',
      redirectUri: 'http://127.0.0.1:5000/callback',
      now: () => t0,
    });
    expect(set.accessToken).toBe('A');
    expect(set.refreshToken).toBe('R');
    expect(set.expiresAt).toBe(t0 + 3600 * 1000);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://a/token');
    expect(call[1]?.method).toBe('POST');
    expect(String(call[1]?.body)).toContain('grant_type=authorization_code');
    expect(String(call[1]?.body)).toContain('code=CODE');
    expect(String(call[1]?.body)).toContain('code_verifier=V');
    expect(String(call[1]?.body)).toContain(
      'redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd native/warehouse-app && npx vitest run src/core/auth/login.test.ts 2>&1 | tail -20`
Expected: FAIL — body contains `redirect_uri=almondwms...` (the old hardcoded value), not the loopback URL.

- [ ] **Step 3: Change `exchangeCode` to take `redirectUri`**

In `native/warehouse-app/src/core/auth/login.ts`, change the `exchangeCode` signature and body (only the param list and the `redirect_uri` line change):
```ts
export async function exchangeCode(p: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  redirectUri: string;
  now?: () => number;
}): Promise<TokenSet> {
  const now = p.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: oidcConfig.clientId,
    code_verifier: p.verifier,
  });
  // ...rest of the function is unchanged...
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd native/warehouse-app && npx vitest run src/core/auth/login.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Split the deep-link flow and add the loopback flow**

In `native/warehouse-app/src/core/auth/login.ts`:

(a) Add `invoke` to the imports at the top:
```ts
import { invoke } from '@tauri-apps/api/core';
```

(b) Add a `discoverEndpoints` export (reuses the existing private `getJson`), placed after `getJson`:
```ts
export async function discoverEndpoints() {
  return discover(oidcConfig.issuer, getJson);
}
```

(c) **Rename** the existing `export async function login(...)` to `loginWithDeepLink`, and update its `exchangeCode` call to pass the custom-scheme redirect (this path is Android-only and unchanged otherwise):
```ts
export async function loginWithDeepLink(deps: {
  manager: ReturnType<typeof createTokenManager>;
}): Promise<void> {
  // ...unchanged body, except the exchangeCode call becomes:
  const tokens = await exchangeCode({
    tokenEndpoint: endpoints.token_endpoint,
    code,
    verifier,
    redirectUri: oidcConfig.redirectUri,
  });
  // ...
}
```

(d) Add the desktop loopback flow:
```ts
export async function loginWithLoopback(deps: {
  manager: ReturnType<typeof createTokenManager>;
}): Promise<void> {
  const endpoints = await discoverEndpoints();
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);

  const { port } = await invoke<{ port: number }>('oauth_loopback_start');
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  await openUrl(buildAuthorizeUrl({ ...oidcConfig, redirectUri }, { state, nonce, challenge }));

  const cb = await invoke<{ code: string; state: string }>('oauth_loopback_wait', { port });
  if (cb.state !== state) throw new Error('state mismatch');

  const tokens = await exchangeCode({
    tokenEndpoint: endpoints.token_endpoint,
    code: cb.code,
    verifier,
    redirectUri,
  });
  await deps.manager.set(tokens);
}
```

- [ ] **Step 6: Run the full suite + type-check**

Run: `cd native/warehouse-app && npx vitest run 2>&1 | tail -8 && npx tsc -b 2>&1 | tail -5 && echo "tsc: $?"`
Expected: all Vitest tests pass; `tsc: 0`.

- [ ] **Step 7: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): loopback login flow + exchangeCode(redirectUri)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Diagnostics `Login` button + userinfo verification

**Files:**
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.test.tsx`

**Interfaces:**
- Consumes: `loginWithLoopback`, `refreshTokens`, `discoverEndpoints` (Task 3); `createStrongholdTokenStore` (tokenStore.ts); `createTokenManager` (tokenManager.ts); `createApiClient` (httpClient.ts); `oidcConfig` (config.ts).
- Produces: a `Login` button that logs in and renders the `userinfo` claims.

- [ ] **Step 1: Add the Login-button assertion to the render test**

In `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.test.tsx`, add inside the existing `it(...)`, after the "test print" assertion:
```ts
    expect(
      screen.getByRole('button', { name: /^login$/i })
    ).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd native/warehouse-app && npx vitest run src/profiles/shared/DiagnosticsScreen.test.tsx 2>&1 | tail -20`
Expected: FAIL — no `Login` button yet.

- [ ] **Step 3: Add the Login section + handler**

In `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`:

(a) Add imports (below the existing imports):
```ts
import {
  loginWithLoopback,
  refreshTokens,
  discoverEndpoints,
} from '../../core/auth/login';
import { createStrongholdTokenStore } from '../../core/auth/tokenStore';
import { createTokenManager } from '../../core/auth/tokenManager';
import { createApiClient } from '../../core/data/httpClient';
import { oidcConfig } from '../../app/config';
```

(b) Inside `DiagnosticsScreen`, add a handler above the `return`:
```ts
  async function onLogin() {
    setStatus('logging in…');
    try {
      const store = createStrongholdTokenStore();
      const manager = createTokenManager({
        store,
        refresh: async (refreshToken) => {
          const eps = await discoverEndpoints();
          return refreshTokens({ tokenEndpoint: eps.token_endpoint, refreshToken });
        },
      });
      await loginWithLoopback({ manager });
      const client = createApiClient({
        baseUrl: oidcConfig.issuer,
        getToken: () => manager.getAccessToken(),
        authMode: 'bearer',
      });
      const info = await client.request<{ sub?: string; email?: string }>({
        path: '/oauth/userinfo',
      });
      setStatus(`logged in: sub=${info.sub ?? '?'} email=${info.email ?? '?'}`);
    } catch (e) {
      setStatus(`login error: ${String(e)}`);
    }
  }
```

(c) Add a new `<section>` before the closing `</div>` (after the Printer section):
```tsx
      <section>
        <h2 className="font-medium">Auth</h2>
        <Button className="mt-2" onClick={onLogin}>
          Login
        </Button>
      </section>
```

- [ ] **Step 4: Run the suite + type-check**

Run: `cd native/warehouse-app && npx vitest run 2>&1 | tail -8 && npx tsc -b 2>&1 | tail -5 && echo "tsc: $?"`
Expected: all Vitest tests pass (including the new Login-button assertion); `tsc: 0`.

- [ ] **Step 5: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): Diagnostics Login button + userinfo check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Config prerequisites + end-to-end verification [manual on-device]

**Files:**
- Create: `native/warehouse-app/.env.local` (gitignored — not committed)
- Modify: `native/warehouse-app/src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes everything above. Produces: a real login round-trip on this box.

- [ ] **Step 1: Register the `warehouse-app` OAuth client (backend)**

Against the dev user-service (admin auth required), create the public client. Replace `<ADMIN_TOKEN>` and `<USER_SERVICE_BASE>`:
```bash
curl -sS -X POST "<USER_SERVICE_BASE>/admin/oauth-clients" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "warehouse-app",
    "clientType": "public",
    "redirectUris": ["http://127.0.0.1/callback"],
    "allowedScopes": ["openid","profile","email","offline_access"]
  }'
```
Expected: `201`/`200` with the client (no secret for a public client). The backend allows any loopback port at authorize time, so the single registered `http://127.0.0.1/callback` matches every ephemeral port.

- [ ] **Step 2: Create `.env.local` with the real dev URLs**

Create `native/warehouse-app/.env.local` (replace the placeholders with real dev values):
```
VITE_OIDC_ISSUER=https://<user-service-base>
VITE_OIDC_AUTHORIZE=https://<auth-web>/oauth/authorize
VITE_OIDC_CLIENT_ID=warehouse-app
VITE_API_BASE_URL=https://<public-api-gateway>
```
(`VITE_OIDC_AUTHORIZE` must equal the `authorization_endpoint` in `<user-service-base>/.well-known/openid-configuration`.)

- [ ] **Step 3: Allow the issuer host in the plugin-http scope**

In `native/warehouse-app/src-tauri/capabilities/default.json`, replace the plain `"http:default"` string entry with a scoped object (substitute the real hosts from `.env.local`):
```json
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://<user-service-host>" },
        { "url": "https://<public-api-host>" }
      ]
    }
```
Leave the other permission strings (`core:default`, `os:default`, `deep-link:default`, `opener:default`, `stronghold:default`) unchanged.

- [ ] **Step 4: Run the desktop app and log in** [manual on-device]

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app && npx tauri dev`
Then in the app:
1. Navigate to the Diagnostics screen and click **Login**.
2. The system browser opens auth-web; complete a real login.
3. The browser lands on the "Login complete — you can close this tab" page.
4. The Diagnostics `status` shows `logged in: sub=… email=…`.

Expected: `status` shows the userinfo claims (proves token acceptance end-to-end). Record any failure as a bug before proceeding. Common checks if it fails: `.env.local` URLs, the http scope hosts, and that the client was registered as `public` with the loopback redirect.

- [ ] **Step 5: Commit the capability change**

(`.env.local` is gitignored and stays local. Commit only the capability scope — omit this commit if the dev host is sensitive and should not be tracked.)
```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src-tauri/capabilities/default.json
git commit -m "chore(warehouse-app): scope plugin-http to the dev auth/api hosts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Rust loopback listener (spec §Components 1) → Task 1.
- `login.ts` rewiring + `exchangeCode(redirectUri)` + retained deep-link (§Components 2) → Task 3.
- Stronghold argon2 (§Components 3) → Task 2.
- Diagnostics Login entry point (§Components 4) → Task 4.
- Client registration + `.env.local` + http scope (§Components 5) → Task 5.
- Testing/verification (§Testing) → Rust unit (Task 1), TS unit (Task 3), e2e (Task 5).

**Placeholder scan:** The `<...>` tokens in Task 5 are real operator-supplied secrets (URLs, admin token), not logic placeholders — every logic step has complete code. The Rust `todo!()` in Task 1 Step 7 is the *existing* line shown for context; Task 2 replaces it.

**Type consistency:** `exchangeCode` gains `redirectUri: string` (Task 3) and every call site passes it (`loginWithLoopback`, `loginWithDeepLink`, Task 3). `oauth_loopback_start`→`{port}` and `oauth_loopback_wait(port)`→`{code,state}` (Task 1) match the `invoke<...>()` generics in `loginWithLoopback` (Task 3). `createTokenManager({store, refresh})`, `createApiClient({baseUrl, getToken, authMode})`, `discoverEndpoints().token_endpoint`/`userinfo_endpoint` used in Task 4 match their Phase 0 definitions.

**Non-goals kept out:** no Android deep-link/intent-filter (path retained but unused on desktop), no updater, no per-install salt hardening, no silent-refresh UI, no business workflows.
