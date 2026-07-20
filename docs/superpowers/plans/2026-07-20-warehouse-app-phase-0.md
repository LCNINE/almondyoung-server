# Warehouse Native App — Phase 0 (Foundation + Hardware Spikes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Tauri 2 shell (Windows + Android) with OIDC/PKCE login, a `plugin-http`+TanStack Query data layer, a design system, platform-based profile routing, and on-device spikes for all three hardware devices (USB-HID scan, camera scan, ZPL test print) surfaced in one Diagnostics screen — with **zero business workflows**.

**Architecture:** One Tauri 2 codebase, two build targets. A `core/` foundation (auth, data, hardware ports, design) knows nothing about workflows; a thin `profiles/` layer boots into `station` (Windows) or `handheld` (Android). Deterministic logic (scan parser, PKCE, OIDC URL/discovery, token refresh, retry, ZPL builder, Rust target parsing) is TDD-tested; OS/hardware glue is verified by an on-device Diagnostics harness.

**Tech Stack:** Tauri 2 (Rust), Vite + React 19 + TypeScript, Tailwind + shadcn/radix, TanStack Query, Vitest + Testing Library, `@tauri-apps/plugin-{http,deep-link,barcode-scanner,stronghold,os,opener,updater}`.

**Design spec:** `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md`

## Global Constraints

- **Node** `>=22 <23` (repo engines). Local is v22.23.1, npm 10.9.8.
- **Standalone project**: lives at `native/warehouse-app/`, its **own `package-lock.json`**, NOT a member of the root workspace (root has no `workspaces` field — nothing to opt out of), and **imports no sibling app code** (결합 0). admin-web / backend DTOs are reference-only.
- **Package manager**: npm (matches admin-web).
- **Prettier** (copy verbatim to `native/warehouse-app/.prettierrc`): `{ "semi": true, "singleQuote": true, "tabWidth": 2, "trailingComma": "es5", "printWidth": 80, "insertPragma": false, "requirePragma": false }`
- **Targets**: Windows + Android only. No macOS/iOS.
- **All backend HTTP goes through `@tauri-apps/plugin-http`** (native reqwest) — never the browser `fetch`. This is what bypasses CORS.
- **Deep-link scheme**: `almondwms://oauth/callback`. App identifier: `kr.lcnine.almondwms`.
- **TDD** for deterministic logic (real failing test first). OS/hardware glue that cannot be unit-tested is verified by the Diagnostics screen on a real device — the plan marks these steps **[manual on-device]**.
- **Commit** after every task (frequent commits). All commits end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch**: continue on `docs/warehouse-native-app-design` (or a fresh `feat/warehouse-app-phase-0` if the executor prefers).

---

## File Structure (created in Phase 0)

```
native/warehouse-app/
├─ package.json, package-lock.json, .prettierrc, .gitignore, tsconfig.json
├─ vite.config.ts                      # Vite + Vitest config
├─ index.html
├─ src/
│  ├─ main.tsx                         # React root, QueryClientProvider, ScanProvider
│  ├─ app/
│  │  ├─ App.tsx                       # shell + profile router
│  │  ├─ profile.ts                    # resolveProfile() (Task 3)
│  │  └─ config.ts                     # runtime config (API base, OIDC, printer)
│  ├─ core/
│  │  ├─ design/                       # shadcn/ui components, tailwind base (Task 2)
│  │  ├─ hardware/
│  │  │  ├─ scan/scanBuffer.ts         # HID keystroke parser (Task 4)
│  │  │  ├─ scan/ScanProvider.tsx      # global keydown → scan stream (Task 5)
│  │  │  ├─ scan/useScanner.ts         # subscribe hook (Task 5)
│  │  │  ├─ scan/camera.ts             # camera scan port (Task 6)
│  │  │  └─ print/zpl.ts               # ZPL template builder (Task 9)
│  │  ├─ auth/
│  │  │  ├─ pkce.ts                    # PKCE helpers (Task 7)
│  │  │  ├─ oidc.ts                    # discovery + authorize URL + callback parse (Task 8)
│  │  │  ├─ tokenStore.ts              # stronghold-backed TokenStore (Task 10)
│  │  │  ├─ tokenManager.ts            # single-flight refresh (Task 10)
│  │  │  └─ login.ts                   # deep-link + system browser flow (Task 11)
│  │  └─ data/
│  │     ├─ authHeader.ts              # bearer|cookie strategy (Task 12)
│  │     ├─ httpClient.ts              # plugin-http wrapper + idempotency + 409 retry (Task 12)
│  │     └─ queryClient.ts             # TanStack Query client (Task 12)
│  └─ profiles/
│     ├─ station/StationHome.tsx       # placeholder home (Task 3)
│     ├─ handheld/HandheldHome.tsx     # placeholder home (Task 3)
│     └─ shared/DiagnosticsScreen.tsx  # the hardware harness (Task 13)
└─ src-tauri/
   ├─ Cargo.toml, tauri.conf.json, build.rs
   ├─ capabilities/default.json        # permission ACL
   └─ src/
      ├─ lib.rs, main.rs
      └─ printing/mod.rs               # print_raw command + parse_target (Task 9)
```

---

## Task 1: Scaffold the Tauri 2 project + toolchain + Vitest

**Files:**
- Create: `native/warehouse-app/` (whole Tauri scaffold)
- Create: `native/warehouse-app/.prettierrc`, `.gitignore`
- Create: `native/warehouse-app/src/example.test.ts`
- Modify: `native/warehouse-app/vite.config.ts`, `package.json`

**Interfaces:**
- Produces: a runnable desktop app window; `npm test` runs Vitest.

- [ ] **Step 1: Install the Rust toolchain (cargo/rustc are absent)**

Run:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustc --version && cargo --version
```
Expected: prints rustc/cargo versions (e.g. `rustc 1.8x`).

- [ ] **Step 2: Install Tauri Linux dev prerequisites (for `tauri dev` on this Linux box)**

Run:
```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
Expected: packages install without error. (These are the standard Tauri v2 Linux deps; needed only to run/verify the desktop build locally.)

- [ ] **Step 3: Scaffold the app with create-tauri-app**

Run:
```bash
mkdir -p native && cd native
npm create tauri-app@latest warehouse-app -- --template react-ts --manager npm --identifier kr.lcnine.almondwms --yes
cd warehouse-app && npm install
```
Expected: `native/warehouse-app` created with `src/` (React+TS) and `src-tauri/`. If the CLI prompts anyway, choose: React, TypeScript, npm.

- [ ] **Step 4: Copy prettier config and write .gitignore**

Create `native/warehouse-app/.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 80,
  "insertPragma": false,
  "requirePragma": false
}
```
Append to `native/warehouse-app/.gitignore` (create if missing):
```
node_modules
dist
src-tauri/target
src-tauri/gen
.env.local
```

- [ ] **Step 5: Add Vitest and configure it**

Run:
```bash
cd native/warehouse-app
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```
Replace `native/warehouse-app/vite.config.ts` with:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port and no clearScreen so its CLI can attach.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```
Create `native/warehouse-app/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom';
```
Add scripts to `native/warehouse-app/package.json` (`"scripts"`):
```json
"test": "vitest run",
"test:watch": "vitest",
"format": "prettier --write \"src/**/*.{ts,tsx}\""
```

- [ ] **Step 6: Write a trivial failing test**

Create `native/warehouse-app/src/example.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { appName } from './app/name';

describe('appName', () => {
  it('is warehouse-app', () => {
    expect(appName()).toBe('warehouse-app');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd native/warehouse-app && npm test`
Expected: FAIL — cannot resolve `./app/name`.

- [ ] **Step 8: Add the minimal implementation**

Create `native/warehouse-app/src/app/name.ts`:
```ts
export function appName(): string {
  return 'warehouse-app';
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 10: Verify the desktop shell runs** [manual on-device]

Run: `npm run tauri dev`
Expected: a native window opens showing the create-tauri-app default page. Close it (Ctrl-C).

- [ ] **Step 11: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app
git commit -m "chore(warehouse-app): scaffold Tauri 2 + Vite/React/TS + Vitest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Tailwind + shadcn design base + app shell

**Files:**
- Modify: `native/warehouse-app/src/main.tsx`, `index.html`, `src/app/App.tsx`
- Create: tailwind config, `src/core/design/` (shadcn primitives)

**Interfaces:**
- Produces: `App` renders a styled shell with a header and a content slot.

- [ ] **Step 1: Install & init Tailwind v4 + shadcn**

Run:
```bash
cd native/warehouse-app
npm install -D tailwindcss @tailwindcss/vite
npm install class-variance-authority clsx tailwind-merge lucide-react
```
Add the Tailwind plugin to `vite.config.ts` `plugins`: `import tailwindcss from '@tailwindcss/vite';` then `tailwindcss()` in the array.
Create `src/index.css`:
```css
@import 'tailwindcss';
```
Import it at the top of `src/main.tsx`: `import './index.css';`

- [ ] **Step 2: Add a `cn` util and a Button primitive (shadcn-style)**

Create `src/core/design/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```
Create `src/core/design/Button.tsx`:
```tsx
import { cn } from './cn';

export function Button({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2',
        'text-sm font-medium text-white transition-colors hover:bg-blue-700',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Write the shell test**

Create `src/app/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByText('Almond WMS')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test src/app/App.test.tsx`
Expected: FAIL — `App` not exported / title missing.

- [ ] **Step 5: Implement the shell**

Create `src/app/App.tsx`:
```tsx
export function App({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="flex h-12 items-center border-b bg-white px-4 font-semibold">
        Almond WMS
      </header>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
```
Update `src/main.tsx` to render `<App />`.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test src/app/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): tailwind + shadcn base + app shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Profile resolution + profile router + placeholder homes

**Files:**
- Create: `src/app/profile.ts`, `src/app/profile.test.ts`
- Create: `src/profiles/station/StationHome.tsx`, `src/profiles/handheld/HandheldHome.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Produces: `type Profile = 'station' | 'handheld'`; `resolveProfile(platform: string, override?: Profile): Profile`.

- [ ] **Step 1: Install the OS plugin (platform detection)**

Run: `cd native/warehouse-app && npm run tauri add os`
Expected: adds `@tauri-apps/plugin-os` + Rust plugin + a permission entry. (`tauri add` wires capabilities automatically.)

- [ ] **Step 2: Write the profile-resolution test**

Create `src/app/profile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveProfile } from './profile';

describe('resolveProfile', () => {
  it('windows → station', () => {
    expect(resolveProfile('windows')).toBe('station');
  });
  it('android → handheld', () => {
    expect(resolveProfile('android')).toBe('handheld');
  });
  it('unknown platform → handheld (safe default)', () => {
    expect(resolveProfile('linux')).toBe('handheld');
  });
  it('override wins over platform', () => {
    expect(resolveProfile('windows', 'handheld')).toBe('handheld');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test src/app/profile.test.ts`
Expected: FAIL — `resolveProfile` not defined.

- [ ] **Step 4: Implement**

Create `src/app/profile.ts`:
```ts
export type Profile = 'station' | 'handheld';

/**
 * Default entry profile per platform (spec §3). Windows packing stations get
 * the station UI; everything else (Android handhelds, dev on linux) defaults
 * to handheld. `override` (from the settings screen) always wins.
 */
export function resolveProfile(platform: string, override?: Profile): Profile {
  if (override) return override;
  return platform === 'windows' ? 'station' : 'handheld';
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test src/app/profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add placeholder homes and wire the router into App**

Create `src/profiles/station/StationHome.tsx`:
```tsx
export function StationHome() {
  return <div data-testid="station-home">Station profile</div>;
}
```
Create `src/profiles/handheld/HandheldHome.tsx`:
```tsx
export function HandheldHome() {
  return <div data-testid="handheld-home">Handheld profile</div>;
}
```
Update `src/main.tsx` to resolve the profile at boot and pass it to `App`:
```tsx
import { platform } from '@tauri-apps/plugin-os';
import { resolveProfile, type Profile } from './app/profile';
import { StationHome } from './profiles/station/StationHome';
import { HandheldHome } from './profiles/handheld/HandheldHome';
import { App } from './app/App';
// ...inside an async bootstrap before ReactDOM render:
const profile: Profile = resolveProfile(platform());
const home = profile === 'station' ? <StationHome /> : <HandheldHome />;
// render <App>{home}</App>
```
(Note: `platform()` from plugin-os is synchronous in v2 and returns `'windows' | 'android' | 'linux' | ...`.)

- [ ] **Step 7: Verify on desktop** [manual on-device]

Run: `npm run tauri dev`
Expected: window shows "Station profile" on Windows, "Handheld profile" on this Linux dev box.

- [ ] **Step 8: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): platform-based profile routing + placeholder homes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HID scan buffer (keystroke-burst parser) — pure logic, TDD

**Files:**
- Create: `src/core/hardware/scan/scanBuffer.ts`, `scanBuffer.test.ts`

**Interfaces:**
- Produces:
  - `interface ScanBufferOptions { terminator?: string; maxInterKeyMs?: number; minLength?: number }`
  - `createScanBuffer(opts?: ScanBufferOptions): { feed(key: string, at: number): string | null; reset(): void }`
  - `feed` returns the assembled code string when a terminator arrives after a fast burst, else `null`. A key that arrives slower than `maxInterKeyMs` after the previous key resets the buffer (that's human typing, not a scan).

- [ ] **Step 1: Write the failing tests**

Create `src/core/hardware/scan/scanBuffer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createScanBuffer } from './scanBuffer';

describe('createScanBuffer', () => {
  it('emits the code when a fast burst ends with Enter', () => {
    const b = createScanBuffer();
    expect(b.feed('8', 0)).toBeNull();
    expect(b.feed('8', 10)).toBeNull();
    expect(b.feed('0', 20)).toBeNull();
    expect(b.feed('1', 30)).toBeNull();
    expect(b.feed('Enter', 40)).toBe('8801');
  });

  it('resets on a slow gap (human typing) and does not emit', () => {
    const b = createScanBuffer({ maxInterKeyMs: 50 });
    b.feed('a', 0);
    b.feed('b', 500); // 500ms gap → typing → buffer reset to just 'b'
    expect(b.feed('Enter', 510)).toBeNull(); // 'b' alone < minLength
  });

  it('ignores a terminator with no accumulated chars', () => {
    const b = createScanBuffer();
    expect(b.feed('Enter', 0)).toBeNull();
  });

  it('respects minLength (rejects too-short bursts)', () => {
    const b = createScanBuffer({ minLength: 4 });
    b.feed('1', 0);
    b.feed('2', 5);
    expect(b.feed('Enter', 10)).toBeNull(); // only 2 chars
  });

  it('supports Tab as terminator', () => {
    const b = createScanBuffer({ terminator: 'Tab' });
    b.feed('X', 0);
    b.feed('Y', 5);
    b.feed('Z', 10);
    b.feed('Q', 15);
    expect(b.feed('Tab', 20)).toBe('XYZQ');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/core/hardware/scan/scanBuffer.test.ts`
Expected: FAIL — `createScanBuffer` not defined.

- [ ] **Step 3: Implement**

Create `src/core/hardware/scan/scanBuffer.ts`:
```ts
export interface ScanBufferOptions {
  /** key name that ends a scan (default 'Enter') */
  terminator?: string;
  /** max ms between keys to still count as one scan burst (default 50) */
  maxInterKeyMs?: number;
  /** minimum code length to emit (default 3) */
  minLength?: number;
}

/**
 * Distinguishes a barcode reader's keystroke burst from human typing:
 * scanners emit chars milliseconds apart and finish with Enter/Tab. Any gap
 * longer than `maxInterKeyMs` is treated as typing and resets the buffer.
 */
export function createScanBuffer(opts: ScanBufferOptions = {}) {
  const terminator = opts.terminator ?? 'Enter';
  const maxInterKeyMs = opts.maxInterKeyMs ?? 50;
  const minLength = opts.minLength ?? 3;

  let chars: string[] = [];
  let lastAt = -Infinity;

  function reset() {
    chars = [];
    lastAt = -Infinity;
  }

  function feed(key: string, at: number): string | null {
    if (key === terminator) {
      const code = chars.join('');
      reset();
      return code.length >= minLength ? code : null;
    }
    // Only single printable characters accumulate; ignore modifiers/arrows.
    if (key.length !== 1) return null;

    if (at - lastAt > maxInterKeyMs) chars = []; // gap → new burst
    chars.push(key);
    lastAt = at;
    return null;
  }

  return { feed, reset };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/core/hardware/scan/scanBuffer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): HID scan buffer (keystroke-burst parser)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ScanProvider + useScanner (global keydown → unified scan stream)

**Files:**
- Create: `src/core/hardware/scan/ScanProvider.tsx`, `src/core/hardware/scan/useScanner.ts`, `ScanProvider.test.tsx`
- Modify: `src/main.tsx` (wrap app in `<ScanProvider>`)

**Interfaces:**
- Produces:
  - `interface ScanEvent { code: string; source: 'hid' | 'camera'; at: number }`
  - `<ScanProvider>` — attaches a window `keydown` listener, feeds `createScanBuffer`, and pushes `ScanEvent{source:'hid'}` to subscribers. Also exposes `emit(event: ScanEvent)` so the camera port (Task 6) can push into the same stream.
  - `useScanner(handler: (e: ScanEvent) => void): void` — subscribe to scan events.
  - `useScanEmit(): (e: ScanEvent) => void` — get the emit fn (used by camera port).

- [ ] **Step 1: Write the test (simulated HID keydown burst)**

Create `src/core/hardware/scan/ScanProvider.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ScanProvider } from './ScanProvider';
import { useScanner } from './useScanner';

function Probe({ onScan }: { onScan: (code: string) => void }) {
  useScanner((e) => onScan(e.code));
  return null;
}

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('ScanProvider', () => {
  it('delivers a HID burst as one ScanEvent', () => {
    const onScan = vi.fn();
    render(
      <ScanProvider>
        <Probe onScan={onScan} />
      </ScanProvider>
    );
    for (const k of ['9', '9', '1', '2', 'Enter']) fireKey(k);
    expect(onScan).toHaveBeenCalledWith('9912');
  });
});
```
(Note: `createScanBuffer` uses timestamps; in the provider use `performance.now()`. Rapid synchronous dispatch in the test is well within `maxInterKeyMs`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/core/hardware/scan/ScanProvider.test.tsx`
Expected: FAIL — modules not defined.

- [ ] **Step 3: Implement the provider, hook, and emit**

Create `src/core/hardware/scan/ScanProvider.tsx`:
```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { createScanBuffer } from './scanBuffer';

export interface ScanEvent {
  code: string;
  source: 'hid' | 'camera';
  at: number;
}

type Handler = (e: ScanEvent) => void;

interface ScanBus {
  subscribe(h: Handler): () => void;
  emit(e: ScanEvent): void;
}

const ScanContext = createContext<ScanBus | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());

  const bus = useMemo<ScanBus>(
    () => ({
      subscribe(h) {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      emit(e) {
        handlers.current.forEach((h) => h(e));
      },
    }),
    []
  );

  useEffect(() => {
    const buffer = createScanBuffer();
    function onKeyDown(ev: KeyboardEvent) {
      const code = buffer.feed(ev.key, performance.now());
      if (code) bus.emit({ code, source: 'hid', at: Date.now() });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bus]);

  return <ScanContext.Provider value={bus}>{children}</ScanContext.Provider>;
}

export function useScanBus(): ScanBus {
  const bus = useContext(ScanContext);
  if (!bus) throw new Error('useScanBus must be used within <ScanProvider>');
  return bus;
}
```
Create `src/core/hardware/scan/useScanner.ts`:
```ts
import { useEffect } from 'react';
import { useScanBus, type ScanEvent } from './ScanProvider';

export function useScanner(handler: (e: ScanEvent) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.subscribe(handler), [bus, handler]);
}

export function useScanEmit(): (e: ScanEvent) => void {
  return useScanBus().emit;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/core/hardware/scan/ScanProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wrap the app**

In `src/main.tsx`, wrap the rendered tree: `<ScanProvider><App>{home}</App></ScanProvider>`.

- [ ] **Step 6: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): ScanProvider + useScanner unified scan stream

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Camera scan port (Android native plugin, feeds the same stream)

**Files:**
- Create: `src/core/hardware/scan/camera.ts`
- Modify: `src-tauri` (via `tauri add barcode-scanner`), `capabilities/default.json`

**Interfaces:**
- Produces: `async function scanWithCamera(emit: (e: ScanEvent) => void): Promise<void>` — opens the native camera scanner (Android) and emits a `ScanEvent{source:'camera'}` on a successful read. On desktop, throws `CameraUnsupportedError` (station uses HID; camera fallback via getUserMedia is out of Phase 0 scope — see spec §4).

- [ ] **Step 1: Add the barcode-scanner plugin**

Run: `cd native/warehouse-app && npm run tauri add barcode-scanner`
Expected: adds `@tauri-apps/plugin-barcode-scanner`, the Rust plugin (mobile), and a permission entry. (This plugin is mobile-only; it compiles as a no-op stub on desktop.)

- [ ] **Step 2: Implement the port**

Create `src/core/hardware/scan/camera.ts`:
```ts
import { scan, Format } from '@tauri-apps/plugin-barcode-scanner';
import { platform } from '@tauri-apps/plugin-os';
import type { ScanEvent } from './ScanProvider';

export class CameraUnsupportedError extends Error {
  constructor() {
    super('Camera scanning is not supported on this platform');
    this.name = 'CameraUnsupportedError';
  }
}

/**
 * Opens the native camera scanner and emits the first successful read into the
 * shared scan bus. Android only in Phase 0; desktop throws.
 */
export async function scanWithCamera(
  emit: (e: ScanEvent) => void
): Promise<void> {
  if (platform() !== 'android') throw new CameraUnsupportedError();
  const result = await scan({
    windowed: false,
    formats: [Format.QRCode, Format.EAN13, Format.Code128],
  });
  emit({ code: result.content, source: 'camera', at: Date.now() });
}
```

- [ ] **Step 3: Verify it type-checks and desktop build still runs** [manual on-device]

Run: `npm run tauri dev` (desktop). Expected: app still boots (camera path is not invoked on desktop). Actual camera scan is verified on Android in Task 13.

- [ ] **Step 4: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): camera scan port (Android) into shared scan stream

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: PKCE helpers — pure logic, TDD

**Files:**
- Create: `src/core/auth/pkce.ts`, `pkce.test.ts`

**Interfaces:**
- Produces:
  - `challengeFromVerifier(verifier: string): Promise<string>` — BASE64URL(SHA256(verifier)) via Web Crypto.
  - `generatePkce(): Promise<{ verifier: string; challenge: string }>`
  - `randomUrlSafe(bytes: number): string` — for state/nonce.

- [ ] **Step 1: Write the test (known PKCE vector from RFC 7636 Appendix B)**

Create `src/core/auth/pkce.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { challengeFromVerifier, randomUrlSafe } from './pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('randomUrlSafe produces url-safe strings of expected length', () => {
    const s = randomUrlSafe(32);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(43); // 32 bytes → 43 b64url chars
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/core/auth/pkce.test.ts`
Expected: FAIL — module not defined.

- [ ] **Step 3: Implement using Web Crypto**

Create `src/core/auth/pkce.ts`:
```ts
function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlSafe(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function generatePkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = randomUrlSafe(64);
  const challenge = await challengeFromVerifier(verifier);
  return { verifier, challenge };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/core/auth/pkce.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): PKCE helpers (RFC 7636)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: OIDC discovery + authorize-URL builder + callback parser — pure logic, TDD

**Files:**
- Create: `src/core/auth/oidc.ts`, `oidc.test.ts`
- Create: `src/app/config.ts`

**Interfaces:**
- Produces:
  - `interface OidcConfig { issuer: string; authorizationEndpoint: string; clientId: string; redirectUri: string; scope: string }`
  - `interface OidcEndpoints { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; jwks_uri: string }`
  - `discover(issuer: string, getJson: (url: string) => Promise<unknown>): Promise<OidcEndpoints>`
  - `buildAuthorizeUrl(cfg, p: { state: string; nonce: string; challenge: string }): string`
  - `parseCallback(url: string): { code: string; state: string }` (throws on missing params or an `error` param).

- [ ] **Step 1: Write the tests**

Create `src/core/auth/oidc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, parseCallback, discover } from './oidc';

const cfg = {
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
  clientId: 'warehouse-app',
  redirectUri: 'almondwms://oauth/callback',
  scope: 'openid profile email offline_access',
};

describe('buildAuthorizeUrl', () => {
  it('includes PKCE + response_type=code + nonce/state', () => {
    const url = new URL(
      buildAuthorizeUrl(cfg, {
        state: 'ST',
        nonce: 'NO',
        challenge: 'CH',
      })
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('warehouse-app');
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('code_challenge')).toBe('CH');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('ST');
    expect(url.searchParams.get('nonce')).toBe('NO');
  });
});

describe('parseCallback', () => {
  it('extracts code and state', () => {
    const r = parseCallback('almondwms://oauth/callback?code=abc&state=ST');
    expect(r).toEqual({ code: 'abc', state: 'ST' });
  });
  it('throws on an error param', () => {
    expect(() =>
      parseCallback('almondwms://oauth/callback?error=access_denied')
    ).toThrow(/access_denied/);
  });
});

describe('discover', () => {
  it('reads the well-known document', async () => {
    const endpoints = {
      authorization_endpoint: 'https://a/authz',
      token_endpoint: 'https://a/token',
      userinfo_endpoint: 'https://a/userinfo',
      jwks_uri: 'https://a/jwks',
    };
    const getJson = async (u: string) => {
      expect(u).toBe(
        'https://auth.example.com/.well-known/openid-configuration'
      );
      return endpoints;
    };
    expect(await discover(cfg.issuer, getJson)).toEqual(endpoints);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/core/auth/oidc.test.ts`
Expected: FAIL — module not defined.

- [ ] **Step 3: Implement**

Create `src/core/auth/oidc.ts`:
```ts
export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

export async function discover(
  issuer: string,
  getJson: (url: string) => Promise<unknown>
): Promise<OidcEndpoints> {
  const doc = (await getJson(
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  )) as OidcEndpoints;
  return doc;
}

export function buildAuthorizeUrl(
  cfg: OidcConfig,
  p: { state: string; nonce: string; challenge: string }
): string {
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', p.state);
  url.searchParams.set('nonce', p.nonce);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function parseCallback(url: string): { code: string; state: string } {
  const u = new URL(url);
  const error = u.searchParams.get('error');
  if (error) throw new Error(`OIDC callback error: ${error}`);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) throw new Error('OIDC callback missing code/state');
  return { code, state };
}
```
Create `src/app/config.ts` (runtime config; values via Vite env, overridable by the settings screen later):
```ts
import type { OidcConfig } from '../core/auth/oidc';

// These come from build-time env (VITE_*) in Phase 0. A settings screen can
// override them at runtime in a later phase (spec §9).
export const oidcConfig: OidcConfig = {
  issuer: import.meta.env.VITE_OIDC_ISSUER ?? '',
  authorizationEndpoint: import.meta.env.VITE_OIDC_AUTHORIZE ?? '',
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'warehouse-app',
  redirectUri: 'almondwms://oauth/callback',
  scope: 'openid profile email offline_access',
};

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
```
Create `native/warehouse-app/.env.local.example`:
```
VITE_OIDC_ISSUER=https://<user-service-issuer>
VITE_OIDC_AUTHORIZE=https://<auth-web>/oauth/authorize
VITE_OIDC_CLIENT_ID=warehouse-app
VITE_API_BASE_URL=https://<public-api-gateway>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/core/auth/oidc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): OIDC discovery + authorize URL + callback parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Rust `print_raw` command + `parse_target` + ZPL builder

**Files:**
- Create: `src-tauri/src/printing/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register command), `Cargo.toml`
- Create: `src/core/hardware/print/zpl.ts`, `zpl.test.ts`

**Interfaces:**
- Produces:
  - Rust command `print_raw(target: String, data: Vec<u8>) -> Result<(), String>`. `target` is either `tcp://<host>:<port>` (default port 9100) or `spooler://<printer-name>` (Windows only).
  - Rust `parse_target(&str) -> Result<PrintTarget, String>` where `enum PrintTarget { Tcp { host: String, port: u16 }, Spooler { name: String } }`.
  - TS `renderTestLabel(p: { title: string; barcode: string }): string` — returns a minimal ZPL string.

- [ ] **Step 1: Write the Rust unit test for `parse_target`**

Create `src-tauri/src/printing/mod.rs` with tests first:
```rust
#[derive(Debug, PartialEq)]
pub enum PrintTarget {
    Tcp { host: String, port: u16 },
    Spooler { name: String },
}

pub fn parse_target(s: &str) -> Result<PrintTarget, String> {
    if let Some(rest) = s.strip_prefix("tcp://") {
        let (host, port) = match rest.rsplit_once(':') {
            Some((h, p)) => (
                h.to_string(),
                p.parse::<u16>().map_err(|_| "bad port".to_string())?,
            ),
            None => (rest.to_string(), 9100u16),
        };
        if host.is_empty() {
            return Err("empty host".into());
        }
        Ok(PrintTarget::Tcp { host, port })
    } else if let Some(name) = s.strip_prefix("spooler://") {
        if name.is_empty() {
            return Err("empty printer name".into());
        }
        Ok(PrintTarget::Spooler {
            name: name.to_string(),
        })
    } else {
        Err(format!("unrecognized target: {s}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tcp_with_port() {
        assert_eq!(
            parse_target("tcp://192.168.0.10:9100").unwrap(),
            PrintTarget::Tcp { host: "192.168.0.10".into(), port: 9100 }
        );
    }

    #[test]
    fn tcp_defaults_port_9100() {
        assert_eq!(
            parse_target("tcp://192.168.0.10").unwrap(),
            PrintTarget::Tcp { host: "192.168.0.10".into(), port: 9100 }
        );
    }

    #[test]
    fn parses_spooler() {
        assert_eq!(
            parse_target("spooler://ZebraZP450").unwrap(),
            PrintTarget::Spooler { name: "ZebraZP450".into() }
        );
    }

    #[test]
    fn rejects_unknown_scheme() {
        assert!(parse_target("http://x").is_err());
    }
}
```

- [ ] **Step 2: Run the Rust test to verify it passes** (parse_target is already implemented above; this task is Rust-first)

Run: `cd native/warehouse-app/src-tauri && cargo test parse`
Expected: PASS (4 tests). (Ensure `mod printing;` is declared in `lib.rs` — Step 4.)

- [ ] **Step 3: Add the TCP + spooler send + the Tauri command**

Append to `src-tauri/src/printing/mod.rs`:
```rust
use std::io::Write;
use std::net::TcpStream;
use std::time::Duration;

fn send_tcp(host: &str, port: u16, data: &[u8]) -> Result<(), String> {
    let mut stream = TcpStream::connect((host, port))
        .map_err(|e| format!("connect {host}:{port} failed: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn send_spooler(name: &str, data: &[u8]) -> Result<(), String> {
    // Windows RAW pass-through print. Uses the `windows` crate spooler APIs.
    // See docs: OpenPrinter/StartDocPrinter(RAW)/WritePrinter/EndDocPrinter.
    crate::printing::win_spooler::print_raw(name, data)
}

#[cfg(not(windows))]
fn send_spooler(_name: &str, _data: &[u8]) -> Result<(), String> {
    Err("spooler printing is only available on Windows".into())
}

#[tauri::command]
pub fn print_raw(target: String, data: Vec<u8>) -> Result<(), String> {
    match parse_target(&target)? {
        PrintTarget::Tcp { host, port } => send_tcp(&host, port, &data),
        PrintTarget::Spooler { name } => send_spooler(&name, &data),
    }
}
```
Add a Windows-only spooler module `src-tauri/src/printing/win_spooler.rs`:
```rust
// Windows RAW spooler print. Compiled only on Windows.
use windows::core::PCWSTR;
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn print_raw(name: &str, data: &[u8]) -> Result<(), String> {
    unsafe {
        let mut handle = PRINTER_HANDLE::default();
        let name_w = wide(name);
        OpenPrinterW(PCWSTR(name_w.as_ptr()), &mut handle, None)
            .map_err(|e| format!("OpenPrinter: {e}"))?;

        let doc_name = wide("almondwms-label");
        let datatype = wide("RAW");
        let doc = DOC_INFO_1W {
            pDocName: PCWSTR(doc_name.as_ptr()),
            pOutputFile: PCWSTR::null(),
            pDatatype: PCWSTR(datatype.as_ptr()),
        };
        StartDocPrinterW(handle, 1, &doc as *const _ as *const u8)
            .ok()
            .map_err(|e| format!("StartDocPrinter: {e}"))?;
        StartPagePrinter(handle).ok().map_err(|e| e.to_string())?;

        let mut written = 0u32;
        WritePrinter(handle, data.as_ptr() as *const _, data.len() as u32, &mut written)
            .ok()
            .map_err(|e| format!("WritePrinter: {e}"))?;

        EndPagePrinter(handle).ok().map_err(|e| e.to_string())?;
        EndDocPrinter(handle).ok().map_err(|e| e.to_string())?;
        ClosePrinter(handle).ok().map_err(|e| e.to_string())?;
        Ok(())
    }
}
```
In `Cargo.toml`, add the Windows-only dependency:
```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
  "Win32_Graphics_Printing",
  "Win32_Foundation",
] }
```
(Note: confirm the exact `windows` crate version/feature paths against docs.rs when building on Windows; the `Win32_Graphics_Printing` feature gates these symbols.)

- [ ] **Step 4: Register the module + command in `lib.rs`**

In `src-tauri/src/lib.rs`: add `mod printing;` (and `#[cfg(windows)] mod win_spooler;` inside `printing/mod.rs` via `pub mod win_spooler;` guarded by `#[cfg(windows)]`), and register the handler:
```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![crate::printing::print_raw])
    // ...existing plugins/setup
```

- [ ] **Step 5: Write the ZPL builder test (TS)**

Create `src/core/hardware/print/zpl.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderTestLabel } from './zpl';

describe('renderTestLabel', () => {
  it('produces a ^XA…^XZ ZPL doc containing the title and barcode', () => {
    const zpl = renderTestLabel({ title: 'TEST', barcode: '123456' });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('TEST');
    expect(zpl).toContain('^BC'); // Code128 barcode command
    expect(zpl).toContain('123456');
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd native/warehouse-app && npm test src/core/hardware/print/zpl.test.ts`
Expected: FAIL — module not defined.

- [ ] **Step 7: Implement the ZPL builder**

Create `src/core/hardware/print/zpl.ts`:
```ts
/**
 * Minimal ZPL test label. Real label templates land in Phase 4; this proves the
 * print path end-to-end. ^XA/^XZ delimit a label; ^FO sets origin; ^A0 a font;
 * ^BC a Code128 barcode; ^FD field data; ^FS field separator.
 */
export function renderTestLabel(p: { title: string; barcode: string }): string {
  return [
    '^XA',
    '^CI28', // UTF-8
    `^FO50,50^A0N,40,40^FD${p.title}^FS`,
    `^FO50,120^BCN,100,Y,N,N^FD${p.barcode}^FS`,
    '^XZ',
  ].join('\n');
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test src/core/hardware/print/zpl.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): print_raw Rust command (tcp/spooler) + ZPL test label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Secure token store + token manager (single-flight refresh) — TDD the refresh logic

**Files:**
- Create: `src/core/auth/tokenStore.ts`, `src/core/auth/tokenManager.ts`, `tokenManager.test.ts`
- Modify: `src-tauri` (via `tauri add stronghold`)

**Interfaces:**
- Produces:
  - `interface TokenSet { accessToken: string; refreshToken: string; idToken?: string; expiresAt: number }` (`expiresAt` = epoch ms).
  - `interface TokenStore { load(): Promise<TokenSet | null>; save(t: TokenSet): Promise<void>; clear(): Promise<void> }`
  - `createStrongholdTokenStore(): TokenStore` (real, wraps `@tauri-apps/plugin-stronghold`).
  - `createTokenManager(deps: { store: TokenStore; refresh: (refreshToken: string) => Promise<TokenSet>; now?: () => number }): { getAccessToken(): Promise<string>; set(t: TokenSet): Promise<void>; clear(): Promise<void> }` — `getAccessToken` returns a still-valid access token or refreshes once (single-flight: concurrent callers share one refresh).

- [ ] **Step 1: Write the token manager tests (fake store + fake refresh)**

Create `src/core/auth/tokenManager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createTokenManager } from './tokenManager';
import type { TokenSet, TokenStore } from './tokenStore';

function memoryStore(initial: TokenSet | null): TokenStore {
  let t = initial;
  return {
    load: async () => t,
    save: async (n) => {
      t = n;
    },
    clear: async () => {
      t = null;
    },
  };
}

const valid: TokenSet = {
  accessToken: 'A',
  refreshToken: 'R',
  expiresAt: 10_000,
};
const expired: TokenSet = { ...valid, accessToken: 'OLD', expiresAt: 1_000 };

describe('createTokenManager', () => {
  it('returns the current access token when still valid', async () => {
    const refresh = vi.fn();
    const m = createTokenManager({
      store: memoryStore(valid),
      refresh,
      now: () => 5_000,
    });
    expect(await m.getAccessToken()).toBe('A');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when expired and persists the new set', async () => {
    const store = memoryStore(expired);
    const refresh = vi.fn(
      async (): Promise<TokenSet> => ({
        accessToken: 'NEW',
        refreshToken: 'R2',
        expiresAt: 20_000,
      })
    );
    const m = createTokenManager({ store, refresh, now: () => 5_000 });
    expect(await m.getAccessToken()).toBe('NEW');
    expect(refresh).toHaveBeenCalledWith('R');
    expect((await store.load())?.refreshToken).toBe('R2');
  });

  it('single-flights concurrent refreshes into one call', async () => {
    let resolve!: (t: TokenSet) => void;
    const refresh = vi.fn(
      () => new Promise<TokenSet>((r) => (resolve = r))
    );
    const m = createTokenManager({
      store: memoryStore(expired),
      refresh,
      now: () => 5_000,
    });
    const p1 = m.getAccessToken();
    const p2 = m.getAccessToken();
    resolve({ accessToken: 'NEW', refreshToken: 'R2', expiresAt: 20_000 });
    expect(await p1).toBe('NEW');
    expect(await p2).toBe('NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/core/auth/tokenManager.test.ts`
Expected: FAIL — modules not defined.

- [ ] **Step 3: Implement the token store interface + types**

Create `src/core/auth/tokenStore.ts`:
```ts
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(t: TokenSet): Promise<void>;
  clear(): Promise<void>;
}
```

- [ ] **Step 4: Implement the token manager**

Create `src/core/auth/tokenManager.ts`:
```ts
import type { TokenSet, TokenStore } from './tokenStore';

const SKEW_MS = 30_000; // refresh 30s early

export function createTokenManager(deps: {
  store: TokenStore;
  refresh: (refreshToken: string) => Promise<TokenSet>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  let inFlight: Promise<TokenSet> | null = null;

  async function getAccessToken(): Promise<string> {
    const current = await deps.store.load();
    if (!current) throw new Error('not authenticated');
    if (now() < current.expiresAt - SKEW_MS) return current.accessToken;

    if (!inFlight) {
      inFlight = deps
        .refresh(current.refreshToken)
        .then(async (next) => {
          await deps.store.save(next);
          return next;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return (await inFlight).accessToken;
  }

  return {
    getAccessToken,
    set: (t: TokenSet) => deps.store.save(t),
    clear: () => deps.store.clear(),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test src/core/auth/tokenManager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Add stronghold and implement the real store**

Run: `cd native/warehouse-app && npm run tauri add stronghold`
Expected: adds `@tauri-apps/plugin-stronghold` + Rust plugin + permission. In `src-tauri/src/lib.rs`, initialize the plugin with an argon2-hashed password (per plugin docs):
```rust
.plugin(tauri_plugin_stronghold::Builder::new(|password| {
    // hash the vault password; see plugin-stronghold docs for argon2 setup
    use argon2::{hash_raw, Config, Variant, Version};
    let salt = b"almondwms-static-salt"; // TODO in a later phase: per-install salt
    hash_raw(password.as_ref(), salt, &Config::default()).expect("hash")
}).build())
```
Add to the real store `src/core/auth/tokenStore.ts` (append):
```ts
import { Stronghold, Client } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';

const VAULT = 'almondwms.hold';
const CLIENT = 'auth';
const KEY = 'tokenSet';

export function createStrongholdTokenStore(): TokenStore {
  let cached: Stronghold | null = null;
  async function hold(): Promise<{ store: Client['store']; sh: Stronghold }> {
    if (!cached) {
      const path = await join(await appDataDir(), VAULT);
      cached = await Stronghold.load(path, 'almondwms'); // vault password
    }
    let client: Client;
    try {
      client = await cached.loadClient(CLIENT);
    } catch {
      client = await cached.createClient(CLIENT);
    }
    return { store: client.getStore(), sh: cached };
  }
  return {
    async load() {
      const { store } = await hold();
      const bytes = await store.get(KEY);
      if (!bytes) return null;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    },
    async save(t) {
      const { store, sh } = await hold();
      await store.insert(KEY, Array.from(new TextEncoder().encode(JSON.stringify(t))));
      await sh.save();
    },
    async clear() {
      const { store, sh } = await hold();
      await store.remove(KEY);
      await sh.save();
    },
  };
}
```
(Note: confirm `Stronghold.load`/`getStore` signatures against the installed plugin version; the shape above matches plugin-stronghold v2. The vault password is static in Phase 0 — hardening to a device-derived secret is a later-phase item.)

- [ ] **Step 7: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): token store (stronghold) + single-flight token manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Login flow — deep link + system browser + code exchange

**Files:**
- Create: `src/core/auth/login.ts`
- Modify: `src-tauri` (via `tauri add deep-link` + `tauri add opener`), `tauri.conf.json`, `capabilities/default.json`

**Interfaces:**
- Consumes: `generatePkce`, `randomUrlSafe` (Task 7); `discover`, `buildAuthorizeUrl`, `parseCallback`, `oidcConfig` (Task 8); `createTokenManager` (Task 10); `apiFetchJson` is NOT used here — token calls use `@tauri-apps/plugin-http` `fetch` directly.
- Produces:
  - `async function login(deps: { manager: ReturnType<typeof createTokenManager> }): Promise<void>` — runs the full PKCE flow and stores the resulting `TokenSet`.
  - `async function exchangeCode(p: { tokenEndpoint: string; code: string; verifier: string }): Promise<TokenSet>`

- [ ] **Step 1: Add deep-link + opener plugins and register the scheme**

Run:
```bash
cd native/warehouse-app
npm run tauri add deep-link
npm run tauri add opener
```
In `src-tauri/tauri.conf.json`, register the scheme (desktop) under `plugins`:
```json
"plugins": {
  "deep-link": {
    "desktop": { "schemes": ["almondwms"] }
  }
}
```
(Android intent-filter registration is generated by `tauri android init` in Task 13; confirm the scheme is present in the generated `AndroidManifest.xml`.)

- [ ] **Step 2: Write the code-exchange test (fake plugin-http)**

Create `src/core/auth/login.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async () =>
    new Response(
      JSON.stringify({
        access_token: 'A',
        refresh_token: 'R',
        id_token: 'I',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ),
}));

import { exchangeCode } from './login';

describe('exchangeCode', () => {
  it('maps the token response to a TokenSet with expiresAt', async () => {
    const t0 = 1_000_000;
    const set = await exchangeCode({
      tokenEndpoint: 'https://a/token',
      code: 'CODE',
      verifier: 'V',
      now: () => t0,
    });
    expect(set.accessToken).toBe('A');
    expect(set.refreshToken).toBe('R');
    expect(set.expiresAt).toBe(t0 + 3600 * 1000);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test src/core/auth/login.test.ts`
Expected: FAIL — module not defined.

- [ ] **Step 4: Implement the exchange + full login flow**

Create `src/core/auth/login.ts`:
```ts
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { generatePkce, randomUrlSafe } from './pkce';
import {
  discover,
  buildAuthorizeUrl,
  parseCallback,
  type OidcEndpoints,
} from './oidc';
import { oidcConfig } from '../../app/config';
import type { TokenSet } from './tokenStore';
import type { createTokenManager } from './tokenManager';

async function getJson(url: string): Promise<unknown> {
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export async function exchangeCode(p: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  now?: () => number;
}): Promise<TokenSet> {
  const now = p.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: oidcConfig.redirectUri,
    client_id: oidcConfig.clientId,
    code_verifier: p.verifier,
  });
  const res = await tauriFetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    idToken: j.id_token,
    expiresAt: now() + j.expires_in * 1000,
  };
}

export async function login(deps: {
  manager: ReturnType<typeof createTokenManager>;
}): Promise<void> {
  const endpoints = (await discover(oidcConfig.issuer, getJson)) as OidcEndpoints;
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);

  const codePromise = new Promise<string>((resolve, reject) => {
    onOpenUrl((urls) => {
      try {
        const { code, state: got } = parseCallback(urls[0]);
        if (got !== state) return reject(new Error('state mismatch'));
        resolve(code);
      } catch (e) {
        reject(e);
      }
    });
  });

  await openUrl(buildAuthorizeUrl(oidcConfig, { state, nonce, challenge }));
  const code = await codePromise;
  const tokens = await exchangeCode({
    tokenEndpoint: endpoints.token_endpoint,
    code,
    verifier,
  });
  await deps.manager.set(tokens);
}
```

- [ ] **Step 5: Run to verify the exchange test passes**

Run: `npm test src/core/auth/login.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): OIDC PKCE login (deep link + system browser + code exchange)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Data layer — plugin-http client + auth header + idempotency + 409 retry + TanStack Query

**Files:**
- Create: `src/core/data/authHeader.ts`, `authHeader.test.ts`
- Create: `src/core/data/httpClient.ts`, `httpClient.test.ts`
- Create: `src/core/data/queryClient.ts`
- Modify: `src-tauri` (via `tauri add http`), `capabilities/default.json`, `src/main.tsx`

**Interfaces:**
- Consumes: `createTokenManager` (Task 10).
- Produces:
  - `authHeader(token: string, mode: 'bearer' | 'cookie'): Record<string, string>`
  - `interface ApiClient { request<T>(opts: { method?: string; path: string; body?: unknown; idempotencyKey?: string }): Promise<T> }`
  - `createApiClient(deps: { baseUrl: string; getToken: () => Promise<string>; authMode: 'bearer' | 'cookie'; doFetch?: typeof import('@tauri-apps/plugin-http').fetch }): ApiClient` — attaches auth + `idempotency-key`, and on HTTP 409 retries once after a caller-provided reload (Phase 0: retry once, then surface).
  - `queryClient` (TanStack Query `QueryClient`).

- [ ] **Step 1: Write the authHeader test**

Create `src/core/data/authHeader.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { authHeader } from './authHeader';

describe('authHeader', () => {
  it('bearer mode', () => {
    expect(authHeader('A', 'bearer')).toEqual({ Authorization: 'Bearer A' });
  });
  it('cookie mode sets accessToken cookie', () => {
    expect(authHeader('A', 'cookie')).toEqual({ Cookie: 'accessToken=A' });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm test src/core/data/authHeader.test.ts` → FAIL.
Create `src/core/data/authHeader.ts`:
```ts
/**
 * The backend today reads tokens from cookies (admin-web proxy sets them). A
 * native client can attach either a Bearer header or a Cookie header. Which one
 * the backend accepts is verification item §13.1 — this switch makes it a
 * one-line config change.
 */
export function authHeader(
  token: string,
  mode: 'bearer' | 'cookie'
): Record<string, string> {
  return mode === 'bearer'
    ? { Authorization: `Bearer ${token}` }
    : { Cookie: `accessToken=${token}` };
}
```
Run again → PASS.

- [ ] **Step 3: Add the http plugin**

Run: `cd native/warehouse-app && npm run tauri add http`
Expected: adds `@tauri-apps/plugin-http` + Rust plugin + permission. In `capabilities/default.json`, ensure an `http:default` permission with a scope allowing the API host (edit the generated `permissions` to include the API base URL host, e.g. `"http:allow-fetch"` with a URL scope — confirm exact permission identifier against plugin-http v2 docs).

- [ ] **Step 4: Write the API client tests (fake fetch)**

Create `src/core/data/httpClient.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('attaches bearer auth + idempotency-key and returns parsed JSON', async () => {
    const doFetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    const out = await client.request<{ ok: boolean }>({
      method: 'POST',
      path: '/inventory/adjust',
      body: { qty: 1 },
      idempotencyKey: 'idem-1',
    });
    expect(out).toEqual({ ok: true });
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe('https://api.test/inventory/adjust');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOK',
      'idempotency-key': 'idem-1',
    });
  });

  it('retries once on 409 then throws with a conflict error', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { message: 'version conflict' }))
      .mockResolvedValueOnce(jsonResponse(409, { message: 'version conflict' }));
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    await expect(
      client.request({ path: '/x', idempotencyKey: 'k' })
    ).rejects.toThrow(/conflict/i);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test src/core/data/httpClient.test.ts` → FAIL.

- [ ] **Step 6: Implement the API client**

Create `src/core/data/httpClient.ts`:
```ts
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { authHeader } from './authHeader';

export class ConflictError extends Error {}

export interface ApiClient {
  request<T>(opts: {
    method?: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<T>;
}

export function createApiClient(deps: {
  baseUrl: string;
  getToken: () => Promise<string>;
  authMode: 'bearer' | 'cookie';
  doFetch?: typeof tauriFetch;
}): ApiClient {
  const doFetch = deps.doFetch ?? tauriFetch;

  async function once(opts: {
    method: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<Response> {
    const token = await deps.getToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeader(token, deps.authMode),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    return doFetch(`${deps.baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  return {
    async request<T>(o: {
      method?: string;
      path: string;
      body?: unknown;
      idempotencyKey?: string;
    }): Promise<T> {
      const method = o.method ?? 'GET';
      let res = await once({ ...o, method });
      // Optimistic-lock: one retry on 409 (idempotency-key makes it safe).
      if (res.status === 409) res = await once({ ...o, method });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        throw new ConflictError(
          (j as { message?: string }).message ?? 'version conflict'
        );
      }
      if (!res.ok) throw new Error(`${method} ${o.path} → ${res.status}`);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npm test src/core/data/httpClient.test.ts` → PASS (2 tests).

- [ ] **Step 8: Add TanStack Query client and provider**

Run: `npm install @tanstack/react-query`
Create `src/core/data/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});
```
In `src/main.tsx`, wrap the tree with `<QueryClientProvider client={queryClient}>` (outermost, then `<ScanProvider>`).

- [ ] **Step 9: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): plugin-http API client (auth/idempotency/409) + TanStack Query

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Diagnostics screen + Android target + end-to-end on-device verification

**Files:**
- Create: `src/profiles/shared/DiagnosticsScreen.tsx`
- Modify: `src/profiles/station/StationHome.tsx`, `src/profiles/handheld/HandheldHome.tsx` (link to Diagnostics)
- Modify: `capabilities/default.json` (camera/http/deep-link/stronghold perms), `tauri.conf.json` (updater stub)

**Interfaces:**
- Consumes: `useScanner`, `useScanEmit` (Task 5); `scanWithCamera` (Task 6); `renderTestLabel` (Task 9); `print_raw` command (Task 9); `login` (Task 11); `createApiClient` + `createTokenManager` + `createStrongholdTokenStore` (Tasks 10/12).
- Produces: a screen that lists live scan events, runs a camera scan, exchanges a login, calls the OIDC `userinfo` endpoint to prove the token works, and fires a test ZPL print.

- [ ] **Step 1: Build the Diagnostics screen**

Create `src/profiles/shared/DiagnosticsScreen.tsx`:
```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/core';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel } from '../../core/hardware/print/zpl';
import type { ScanEvent } from '../../core/hardware/scan/ScanProvider';

export function DiagnosticsScreen() {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState('');
  const emit = useScanEmit();
  useScanner((e) => setScans((s) => [e, ...s].slice(0, 20)));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Diagnostics</h1>

      <section>
        <h2 className="font-medium">Scans (HID + camera)</h2>
        <ul className="mt-1 max-h-40 overflow-auto text-sm">
          {scans.map((s, i) => (
            <li key={i}>
              [{s.source}] {s.code}
            </li>
          ))}
        </ul>
        <Button
          className="mt-2"
          onClick={() => scanWithCamera(emit).catch((e) => setStatus(String(e)))}
        >
          Camera scan
        </Button>
      </section>

      <section>
        <h2 className="font-medium">Printer</h2>
        <Button
          onClick={async () => {
            const zpl = renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' });
            const target =
              prompt('Printer target', 'tcp://192.168.0.100:9100') ?? '';
            try {
              await invoke('print_raw', {
                target,
                data: Array.from(new TextEncoder().encode(zpl)),
              });
              setStatus('printed');
            } catch (e) {
              setStatus(`print error: ${e}`);
            }
          }}
        >
          Test print
        </Button>
      </section>

      <p className="text-sm text-gray-600">{status}</p>
    </div>
  );
}
```
Add a "Diagnostics" `Button` to both `StationHome` and `HandheldHome` that renders `<DiagnosticsScreen />` (simple `useState` toggle is fine for Phase 0).

- [ ] **Step 2: Verify desktop diagnostics (HID scan + test print)** [manual on-device]

Run: `npm run tauri dev` on a Windows station (or this Linux box for HID).
- Scan a barcode with the USB reader → it appears in the Scans list as `[hid] <code>`.
- Click "Test print" with a reachable `tcp://<printer-ip>:9100` → a label prints. (On Windows with a USB Zebra queue, use `spooler://<PrinterName>`.)
Expected: both work. Record any failures as bugs before proceeding.

- [ ] **Step 3: Initialize and build the Android target**

Run:
```bash
cd native/warehouse-app
# Android SDK/NDK must be installed and ANDROID_HOME/NDK_HOME exported first.
npm run tauri android init
```
Expected: generates `src-tauri/gen/android`. Confirm the deep-link intent-filter for scheme `almondwms` is present in the generated `AndroidManifest.xml`; add it if missing (per plugin-deep-link Android docs).

- [ ] **Step 4: Verify Android diagnostics (camera scan + HID + login)** [manual on-device]

Run: `npm run tauri android dev` with a device/emulator.
- Tap "Camera scan" → native scanner opens, scan a QR → appears as `[camera] <code>`.
- Plug a USB-OTG HID reader → scans appear as `[hid] <code>`.
- Run the login flow (wire a "Login" button that calls `login({ manager })` where `manager = createTokenManager({ store: createStrongholdTokenStore(), refresh })`) → system browser opens auth-web, after login the app receives the deep-link callback and stores tokens.
- Call the OIDC `userinfo_endpoint` via the API client with the access token → returns the user's claims (proves the token is accepted). Show the result in `status`.
Expected: login round-trips and userinfo returns 200. This closes verification items §13.1/§13.2 empirically.

- [ ] **Step 5: Add an updater config stub + Windows/Android build smoke** [manual on-device]

In `tauri.conf.json`, add a `plugins.updater` block with a placeholder endpoint (real signing keys + S3 endpoint are a later-phase item; the stub just verifies the build accepts the config). Then:
```bash
npm run tauri build            # Windows → .msi (run on Windows)
npm run tauri android build    # → .apk
```
Expected: both produce installable artifacts. (Signing warnings are acceptable in Phase 0.)

- [ ] **Step 6: Commit**

```bash
git add native/warehouse-app
git commit -m "feat(warehouse-app): diagnostics harness + android target + e2e hardware/auth verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 0 scope from spec §11):**
- Tauri Win+Android shell → Tasks 1, 3, 13.
- OIDC PKCE login + token storage → Tasks 7, 8, 10, 11.
- `plugin-http` + TanStack Query data layer → Task 12.
- Design system → Task 2.
- Profile bootstrap/routing → Task 3.
- Hardware spikes: USB-HID scan → Tasks 4, 5; camera scan → Task 6; ZPL test print → Task 9; all surfaced in the Diagnostics screen → Task 13.
- Diagnostics screen (harness) → Task 13.
- CORS-bypass via native HTTP → Task 12 (uses `@tauri-apps/plugin-http`).
- Verification items §13.1/§13.2 (token acceptance / public reachability) → empirically closed in Task 13 Step 4; `authHeader` (Task 12) makes bearer/cookie a one-line switch.

**Placeholder scan:** No "TBD/implement later" logic steps. Two explicitly-scoped Phase-0-deferrals are labeled (static stronghold salt/password → later hardening; updater signing keys/S3 endpoint → later phase) — these are real, intentional scope boundaries, not missing logic. A few "confirm exact signature/permission id against the installed plugin version" notes remain where a plugin's precise API/permission identifier depends on the resolved version — these are verification prompts, not placeholders for logic.

**Type consistency:** `ScanEvent` (Task 5) is consumed unchanged by Tasks 6/13. `TokenSet`/`TokenStore` (Task 10) are consumed by Tasks 11/12/13. `createTokenManager`'s shape (Task 10) matches its use in Tasks 11/13. `createApiClient`/`authHeader` (Task 12) match their consumption in Task 13. `print_raw(target, data)` (Task 9) matches the `invoke('print_raw', { target, data })` call in Task 13.

**Non-goals kept out:** no business workflows (inventory/inbound/picking/packing) — those are Phases 1–4. No offline queue. No web `getUserMedia` camera fallback (desktop camera is out of Phase 0 per spec §4).
