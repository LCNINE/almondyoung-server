# 물류 현장 앱 — 페이지 구조(스켈레톤) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `native/warehouse-app`에 두 프로필 허브 + 전체 라우트 스텁 + 재고조회 1화면 실제 API 배선을 얹어, 이후 워크플로우가 복붙할 데이터훅 규약을 확립한다.

**Architecture:** 작업 허브(타일) → 워크플로우 전체화면 드릴인. 스캔은 워크플로우 내부에서. 조회 화면은 양 프로필 공통, 작업 화면은 프로필별. 데이터는 `createApiClient`(기존) → 신규 `ApiClientProvider` DI → `domains/*` TanStack Query 훅.

**Tech Stack:** Vite + React 19 + TypeScript, TanStack Router(메모리 히스토리) + TanStack Query, Tailwind, lucide-react, Vitest + Testing Library(jsdom).

## Global Constraints

- 작업 디렉터리: 모든 명령은 `native/warehouse-app/`에서 실행. 이 프로젝트는 루트 npm workspace 밖 독립 프로젝트 — 형제 앱(`apps/*`) 코드 import 금지.
- 테스트: `npm run test` (= `vitest run`). 린트: `npm run lint` (= `oxlint`).
- `any`/`as` 금지(정당화 주석 없이). 예외는 기존 코드가 이미 쓰는 패턴(`doFetch as never` 테스트 목)만.
- 라우트는 플랫(`/inventory`, `/stocktaking`…), 모두 `authedRoute` 자식. 프로필 구분은 URL이 아니라 허브 링크로만.
- UI 카피는 한글. 아이콘은 `lucide-react`.
- 커밋은 각 Task 끝에서. 커밋 메시지 말미:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 백엔드 계약(참고): `GET /inventory/skus?name=&code=&barcode=` → `SkuResponseDto[]`. `SkuResponseDto` 표시 필드 = `id`, `code`, `name`, `optionKey?`.

## 파일 구조

**신규**
- `src/core/design/HubTile.tsx` — `HubTile`(아이콘+라벨 타일 본문), `TileGrid`(2열 격자 컨테이너). 프레젠테이션만(Link 없음).
- `src/core/design/PlaceholderScreen.tsx` — 스텁 화면(제목·안내·홈 링크).
- `src/core/data/errorMessage.ts` — 에러 → 현장 친화 한글 메시지.
- `src/core/data/ApiClientProvider.tsx` — `ApiClientProvider` + `useApiClient`(+테스트용 `client` override).
- `src/domains/inventory/types.ts` — `SkuSearchItem`.
- `src/domains/inventory/useSkuSearch.ts` — 검색 훅.
- `src/domains/inventory/InventoryLookupScreen.tsx` — 재고조회 화면(Link 없음, 단위 테스트 대상).
- `src/app/routes/InventoryLookupRoute.tsx` — 라우트 글루(홈 Link + 화면).
- 테스트: `HubTile.test.tsx`, `PlaceholderScreen.test.tsx`, `ApiClientProvider.test.tsx`, `errorMessage.test.ts`, `InventoryLookupScreen.test.tsx`, `router.handheld.test.tsx`.

**수정**
- `src/app/routeTree.tsx` — 신규 라우트 등록(스텁은 인라인 `PlaceholderScreen`, `/inventory`는 Task 1 스텁 → Task 3 실제 교체).
- `src/profiles/station/StationHome.tsx` · `src/profiles/handheld/HandheldHome.tsx` — 실제 타일.
- `src/app/config.ts` — `apiAuthMode` 추가.
- `src/main.tsx` — `ApiClientProvider` 배선.
- `src/app/router.test.tsx` — 허브 변경에 맞춰 단언 갱신.

---

### Task 1: 이동 가능한 스켈레톤 — 허브 타일 + 스텁 라우트

**Files:**
- Create: `src/core/design/HubTile.tsx`, `src/core/design/HubTile.test.tsx`
- Create: `src/core/design/PlaceholderScreen.tsx`, `src/core/design/PlaceholderScreen.test.tsx`
- Modify: `src/app/routeTree.tsx`
- Modify: `src/profiles/station/StationHome.tsx`, `src/profiles/handheld/HandheldHome.tsx`
- Modify: `src/app/router.test.tsx`
- Create: `src/app/router.handheld.test.tsx`

**Interfaces:**
- Produces:
  - `HubTile({ icon: LucideIcon; label: string })` — 타일 본문.
  - `TileGrid({ children: React.ReactNode })` — 2열 격자.
  - `PlaceholderScreen({ title: string; note?: string })` — 홈(`/`) 링크 + 제목 + 안내.
  - 라우트: `/inventory`(스텁), `/inventory/$sku`, `/shipments`, `/stocktaking`, `/movement`, `/inbound`, `/picking`, `/packing`, `/settings` — 모두 `authedRoute` 자식.

- [ ] **Step 1: HubTile 실패 테스트**

`src/core/design/HubTile.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { HubTile, TileGrid } from './HubTile';

describe('HubTile / TileGrid', () => {
  it('renders label and icon inside a grid', () => {
    render(
      <TileGrid>
        <HubTile icon={Search} label="재고조회" />
      </TileGrid>
    );
    expect(screen.getByText('재고조회')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- HubTile`
Expected: FAIL — `Cannot find module './HubTile'`.

- [ ] **Step 3: HubTile 구현**

`src/core/design/HubTile.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react';

/** 프레젠테이션 타일 본문. 네비게이션은 호출부에서 <Link>로 감싼다. */
export function HubTile({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm active:bg-gray-50">
      <Icon className="h-7 w-7 text-blue-600" aria-hidden />
      <span className="text-sm font-semibold text-gray-800">{label}</span>
    </div>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- HubTile`
Expected: PASS.

- [ ] **Step 5: PlaceholderScreen 실패 테스트**

`src/core/design/PlaceholderScreen.test.tsx` (Link을 쓰므로 최소 라우터로 감싼다):
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createMemoryHistory,
} from '@tanstack/react-router';
import { PlaceholderScreen } from './PlaceholderScreen';

function renderInRouter(node: React.ReactNode) {
  const root = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('PlaceholderScreen', () => {
  it('shows the title, note and a home link', async () => {
    renderInRouter(<PlaceholderScreen title="실사" note="Phase 1에서 구현됩니다." />);
    expect(
      await screen.findByRole('heading', { name: '실사' })
    ).toBeInTheDocument();
    expect(screen.getByText('Phase 1에서 구현됩니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /홈/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npm run test -- PlaceholderScreen`
Expected: FAIL — `Cannot find module './PlaceholderScreen'`.

- [ ] **Step 7: PlaceholderScreen 구현**

`src/core/design/PlaceholderScreen.tsx`:
```tsx
import { Link } from '@tanstack/react-router';
import { Button } from './Button';

export function PlaceholderScreen({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-4">
      <Link to="/">
        <Button>← 홈</Button>
      </Link>
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">{note ?? '준비 중입니다.'}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 통과 확인**

Run: `npm run test -- PlaceholderScreen`
Expected: PASS.

- [ ] **Step 9: 라우트 등록**

`src/app/routeTree.tsx` 전체를 아래로 교체(기존 login/authed/index/diagnostics 유지 + 신규 스텁 추가):
```tsx
import {
  createRootRouteWithContext,
  createRoute,
} from '@tanstack/react-router';
import type { Session } from '../core/auth/session';
import { requireAuth, requireAnon } from './guards';
import { RootLayout } from './routes/RootLayout';
import { LoginRoute } from './routes/LoginRoute';
import { AuthedLayout } from './routes/AuthedLayout';
import { ProfileHome } from './routes/ProfileHome';
import { DiagnosticsRoute } from './routes/DiagnosticsRoute';
import { PlaceholderScreen } from '../core/design/PlaceholderScreen';

export interface RouterContext {
  session: Session;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: ({ context }) => requireAnon(context.session),
  component: LoginRoute,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: ({ context }) => requireAuth(context.session),
  component: AuthedLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: ProfileHome,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/diagnostics',
  component: DiagnosticsRoute,
});

// --- 조회 (공통) ---
// /inventory 는 Task 3 에서 실제 화면(InventoryLookupRoute)으로 교체된다.
const inventoryRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory',
  component: () => <PlaceholderScreen title="재고조회" note="곧 연결됩니다." />,
});
const inventoryDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory/$sku',
  component: () => <PlaceholderScreen title="상품 재고 상세" note="후속 Phase에서 구현됩니다." />,
});
const shipmentsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/shipments',
  component: () => <PlaceholderScreen title="출고/송장 조회" note="후속 Phase에서 구현됩니다." />,
});

// --- 작업 · 핸드헬드 ---
const stocktakingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking',
  component: () => <PlaceholderScreen title="실사" note="Phase 1에서 구현됩니다." />,
});
const movementRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/movement',
  component: () => <PlaceholderScreen title="이동" note="Phase 1에서 구현됩니다." />,
});
const inboundRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound',
  component: () => <PlaceholderScreen title="입고/검수" note="Phase 2에서 구현됩니다." />,
});
const pickingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/picking',
  component: () => <PlaceholderScreen title="피킹" note="Phase 3에서 구현됩니다." />,
});

// --- 작업 · 스테이션 ---
const packingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/packing',
  component: () => <PlaceholderScreen title="패킹 + 운송장" note="Phase 4에서 구현됩니다." />,
});

// --- 공통 유틸 ---
const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: () => <PlaceholderScreen title="설정" note="런타임 설정은 후속 Phase에서 구현됩니다." />,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([
    indexRoute,
    diagnosticsRoute,
    inventoryRoute,
    inventoryDetailRoute,
    shipmentsRoute,
    stocktakingRoute,
    movementRoute,
    inboundRoute,
    pickingRoute,
    packingRoute,
    settingsRoute,
  ]),
]);
```

- [ ] **Step 10: 핸드헬드 허브 타일**

`src/profiles/handheld/HandheldHome.tsx` 전체 교체:
```tsx
import { Link } from '@tanstack/react-router';
import {
  Search,
  ClipboardCheck,
  ArrowLeftRight,
  PackagePlus,
  ListChecks,
  Wrench,
  Settings,
} from 'lucide-react';
import { TileGrid, HubTile } from '../../core/design/HubTile';

export function HandheldHome() {
  return (
    <div data-testid="handheld-home" className="space-y-4">
      <TileGrid>
        <Link to="/inventory"><HubTile icon={Search} label="재고조회" /></Link>
        <Link to="/stocktaking"><HubTile icon={ClipboardCheck} label="실사" /></Link>
        <Link to="/movement"><HubTile icon={ArrowLeftRight} label="이동" /></Link>
        <Link to="/inbound"><HubTile icon={PackagePlus} label="입고/검수" /></Link>
        <Link to="/picking"><HubTile icon={ListChecks} label="피킹" /></Link>
        <Link to="/diagnostics"><HubTile icon={Wrench} label="진단" /></Link>
        <Link to="/settings"><HubTile icon={Settings} label="설정" /></Link>
      </TileGrid>
    </div>
  );
}
```

- [ ] **Step 11: 스테이션 허브 타일**

`src/profiles/station/StationHome.tsx` 전체 교체:
```tsx
import { Link } from '@tanstack/react-router';
import { Search, PackageCheck, Truck, Wrench, Settings } from 'lucide-react';
import { TileGrid, HubTile } from '../../core/design/HubTile';

export function StationHome() {
  return (
    <div data-testid="station-home" className="space-y-4">
      <TileGrid>
        <Link to="/inventory"><HubTile icon={Search} label="재고조회" /></Link>
        <Link to="/packing"><HubTile icon={PackageCheck} label="패킹" /></Link>
        <Link to="/shipments"><HubTile icon={Truck} label="출고조회" /></Link>
        <Link to="/diagnostics"><HubTile icon={Wrench} label="진단" /></Link>
        <Link to="/settings"><HubTile icon={Settings} label="설정" /></Link>
      </TileGrid>
    </div>
  );
}
```

- [ ] **Step 12: 기존 router.test.tsx 단언 갱신**

`src/app/router.test.tsx`에서 station 허브는 이제 `'Station profile'` 텍스트 대신 `재고조회` 타일을 렌더한다. 세 곳의 `screen.findByText('Station profile')`를 아래로 교체:
```tsx
// (3곳 모두) 변경 전:
//   expect(await screen.findByText('Station profile')).toBeInTheDocument();
// 변경 후:
expect(
  await screen.findByRole('link', { name: /재고조회/ })
).toBeInTheDocument();
```
그리고 diagnostics 네비게이션 테스트의 클릭 대상(타일 라벨이 한글 "진단"으로 바뀜)을 교체:
```tsx
// 변경 전: await user.click(screen.getByRole('link', { name: /diagnostics/i }));
// 변경 후:
await user.click(screen.getByRole('link', { name: /진단/ }));
```
(diagnostics 화면 heading `/diagnostics/i`와 back link `/home/i`, "홈으로" 복귀 후 재고조회 링크 재확인은 그대로 통과.) 마지막 복귀 단언도 `재고조회` 링크로:
```tsx
// 변경 전(마지막): expect(await screen.findByText('Station profile')).toBeInTheDocument();
// 변경 후:
expect(
  await screen.findByRole('link', { name: /재고조회/ })
).toBeInTheDocument();
```

- [ ] **Step 13: 핸드헬드 라우터 테스트 추가**

`src/app/router.handheld.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { createAppRouter } from './router';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));

function stub(): Session {
  return {
    bootstrap: async () => {},
    isAuthenticated: () => true,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  } satisfies Session;
}

describe('handheld hub navigation', () => {
  it('shows handheld tiles and drills into a placeholder workflow', async () => {
    const session = stub();
    const user = userEvent.setup();
    render(
      <SessionProvider session={session}>
        <ScanProvider>
          <RouterProvider router={createAppRouter(session)} />
        </ScanProvider>
      </SessionProvider>
    );

    expect(await screen.findByRole('link', { name: /실사/ })).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: /실사/ }));
    });
    expect(await screen.findByRole('heading', { name: '실사' })).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: /홈/ }));
    });
    expect(await screen.findByRole('link', { name: /재고조회/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: 전체 테스트 + 린트**

Run: `npm run test && npm run lint`
Expected: 전부 PASS, oxlint 신규 error 0.

- [ ] **Step 15: 커밋**

```bash
git add src/core/design/HubTile.tsx src/core/design/HubTile.test.tsx \
  src/core/design/PlaceholderScreen.tsx src/core/design/PlaceholderScreen.test.tsx \
  src/app/routeTree.tsx src/profiles/station/StationHome.tsx \
  src/profiles/handheld/HandheldHome.tsx src/app/router.test.tsx \
  src/app/router.handheld.test.tsx
git commit -m "feat(warehouse-app): 허브 타일 + 이동 가능한 스텁 라우트 스켈레톤

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ApiClient DI 심 — 설정 + Provider + main 배선

**Files:**
- Modify: `src/app/config.ts`
- Create: `src/core/data/ApiClientProvider.tsx`, `src/core/data/ApiClientProvider.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `createApiClient`, `ApiClient` (from `src/core/data/httpClient.ts`); `useSession` (from `src/app/session-context.tsx`); `apiBaseUrl` (from `src/app/config.ts`).
- Produces:
  - `apiAuthMode: 'bearer' | 'cookie'` (config).
  - `ApiClientProvider({ client?: ApiClient; children })` — `client` 미지정 시 세션에서 빌드.
  - `useApiClient(): ApiClient` — provider 밖에서 호출 시 throw.

- [ ] **Step 1: config에 apiAuthMode 추가**

`src/app/config.ts` 끝에 추가:
```tsx
// 백엔드 토큰 수용 방식(검증 §13.1). 오늘 백엔드는 쿠키를 읽으므로 기본 'cookie',
// Bearer 수용이 확인되면 VITE_API_AUTH_MODE=bearer 로 전환.
const rawAuthMode = import.meta.env.VITE_API_AUTH_MODE;
export const apiAuthMode: 'bearer' | 'cookie' =
  rawAuthMode === 'bearer' ? 'bearer' : 'cookie';
```

- [ ] **Step 2: ApiClientProvider 실패 테스트**

`src/core/data/ApiClientProvider.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider, useApiClient } from './ApiClientProvider';
import type { Session } from '../../core/auth/session';

const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
);
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

function Probe() {
  const api = useApiClient();
  useEffect(() => {
    void api.request({ path: '/ping' });
  }, [api]);
  return <div>probe</div>;
}

describe('ApiClientProvider', () => {
  it('builds a client from the session and attaches the token', async () => {
    render(
      <SessionProvider session={session}>
        <ApiClientProvider>
          <Probe />
        </ApiClientProvider>
      </SessionProvider>
    );
    expect(screen.getByText('probe')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/ping'); // apiBaseUrl '' in test env
    expect(init.headers).toMatchObject({ Cookie: 'accessToken=tok' });
  });

  it('throws when useApiClient is used outside the provider', () => {
    function Bare() {
      useApiClient();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ApiClientProvider/);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test -- ApiClientProvider`
Expected: FAIL — `Cannot find module './ApiClientProvider'`.

- [ ] **Step 4: ApiClientProvider 구현**

`src/core/data/ApiClientProvider.tsx`:
```tsx
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient, type ApiClient } from './httpClient';
import { useSession } from '../../app/session-context';
import { apiBaseUrl, apiAuthMode } from '../../app/config';

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client?: ApiClient;
  children: ReactNode;
}) {
  const session = useSession();
  const value = useMemo(
    () =>
      client ??
      createApiClient({
        baseUrl: apiBaseUrl,
        getToken: () => session.getAccessToken(),
        authMode: apiAuthMode,
      }),
    [client, session]
  );
  return (
    <ApiClientContext.Provider value={value}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const c = useContext(ApiClientContext);
  if (!c) throw new Error('useApiClient must be used within an ApiClientProvider');
  return c;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test -- ApiClientProvider`
Expected: PASS (두 테스트 모두).

- [ ] **Step 6: main.tsx 배선**

`src/main.tsx`의 provider 트리에서 `SessionProvider` 바로 안쪽에 `ApiClientProvider`를 추가:
```tsx
import { ApiClientProvider } from './core/data/ApiClientProvider';
// ...
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <ApiClientProvider>
          <ScanProvider>
            <Bootstrap session={session}>
              <RouterProvider router={router} />
            </Bootstrap>
          </ScanProvider>
        </ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 7: 전체 테스트 + 빌드 + 린트**

Run: `npm run test && npm run build && npm run lint`
Expected: 전부 PASS. (`build` = `tsc -b && vite build` — 타입 회귀 확인.)

- [ ] **Step 8: 커밋**

```bash
git add src/app/config.ts src/core/data/ApiClientProvider.tsx \
  src/core/data/ApiClientProvider.test.tsx src/main.tsx
git commit -m "feat(warehouse-app): ApiClientProvider DI 심 + apiAuthMode 설정

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 참조 배선 — 재고조회 화면(실제 API)

**Files:**
- Create: `src/core/data/errorMessage.ts`, `src/core/data/errorMessage.test.ts`
- Create: `src/domains/inventory/types.ts`
- Create: `src/domains/inventory/useSkuSearch.ts`
- Create: `src/domains/inventory/InventoryLookupScreen.tsx`, `src/domains/inventory/InventoryLookupScreen.test.tsx`
- Create: `src/app/routes/InventoryLookupRoute.tsx`
- Modify: `src/app/routeTree.tsx`

**Interfaces:**
- Consumes: `useApiClient` (Task 2); `ConflictError` (from `httpClient.ts`); `PlaceholderScreen` import는 `/inventory`에서 제거.
- Produces:
  - `errorMessage(error: unknown): string`.
  - `SkuSearchItem { id: string; code: string; name: string; optionKey?: string | null }`.
  - `useSkuSearch(query: string)` — TanStack Query `useQuery`, `data: SkuSearchItem[]`.
  - `InventoryLookupScreen()` — Link 없음(단위 테스트 대상).
  - `InventoryLookupRoute()` — 홈 Link + `InventoryLookupScreen`.

- [ ] **Step 1: errorMessage 실패 테스트**

`src/core/data/errorMessage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { errorMessage } from './errorMessage';
import { ConflictError } from './httpClient';

describe('errorMessage', () => {
  it('maps a ConflictError to a retry message', () => {
    expect(errorMessage(new ConflictError('x'))).toMatch(/먼저 변경/);
  });
  it('maps a 404 status embedded in the message', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toMatch(/찾을 수 없/);
  });
  it('maps a 500 status to a server message', () => {
    expect(errorMessage(new Error('GET /x → 500'))).toMatch(/서버/);
  });
  it('falls back for unknown values', () => {
    expect(errorMessage('nope')).toMatch(/알 수 없/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- errorMessage`
Expected: FAIL — `Cannot find module './errorMessage'`.

- [ ] **Step 3: errorMessage 구현**

`src/core/data/errorMessage.ts` (상태코드는 httpClient가 던지는 `"METHOD path → NNN"` 형식에서 추출):
```ts
import { ConflictError } from './httpClient';

export function errorMessage(error: unknown): string {
  if (error instanceof ConflictError) {
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
    if (status === 401 || status === 403) return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
  }
  return '알 수 없는 오류가 발생했어요.';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- errorMessage`
Expected: PASS.

- [ ] **Step 5: 도메인 타입 + 검색 훅**

`src/domains/inventory/types.ts`:
```ts
/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
}
```

`src/domains/inventory/useSkuSearch.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

/** GET /inventory/skus?name=<q> → SkuResponseDto[] (부분집합으로 수신). */
export function useSkuSearch(query: string) {
  const api = useApiClient();
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['sku-search', trimmed],
    enabled: trimmed.length > 0,
    queryFn: () =>
      api.request<SkuSearchItem[]>({
        path: `/inventory/skus?name=${encodeURIComponent(trimmed)}`,
      }),
  });
}
```

- [ ] **Step 6: 재고조회 화면 실패 테스트**

`src/domains/inventory/InventoryLookupScreen.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { InventoryLookupScreen } from './InventoryLookupScreen';

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

function renderWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <InventoryLookupScreen />
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('InventoryLookupScreen', () => {
  it('searches and lists results', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => [
        { id: '1', code: 'SKU-8891', name: '코튼 티', optionKey: '흰색 / M' },
      ]) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('코튼 티')).toBeInTheDocument();
    expect(screen.getByText(/SKU-8891/)).toBeInTheDocument();
  });

  it('shows a friendly message on error', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new Error('GET /inventory/skus → 500');
      }) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/서버/);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npm run test -- InventoryLookupScreen`
Expected: FAIL — `Cannot find module './InventoryLookupScreen'`.

- [ ] **Step 8: 재고조회 화면 구현**

`src/domains/inventory/InventoryLookupScreen.tsx` (Link 없음 — 라우트 글루에서 감쌈):
```tsx
import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { errorMessage } from '../../core/data/errorMessage';
import { useSkuSearch } from './useSkuSearch';

export function InventoryLookupScreen() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError, error } = useSkuSearch(query);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">재고조회</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(term);
        }}
      >
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="상품명 검색 또는 바코드 스캔"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit">검색</Button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">조회 중…</p>}
      {isError && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(error)}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-gray-500">결과가 없어요.</p>
      )}
      <ul className="space-y-2">
        {data?.map((s) => (
          <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="font-medium text-gray-800">{s.name}</div>
            <div className="text-xs text-gray-500">
              {s.code}
              {s.optionKey ? ` · ${s.optionKey}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> 스캔 연동: HID 키보드 웨지는 입력창에 타이핑 후 Enter → form submit로 자연 동작한다. 전역 `useScanner()` 연동(입력창 미포커스에도 스캔 반영)은 후속 개선.

- [ ] **Step 9: 통과 확인**

Run: `npm run test -- InventoryLookupScreen`
Expected: PASS (두 테스트 모두).

- [ ] **Step 10: 라우트 글루 + routeTree 교체**

`src/app/routes/InventoryLookupRoute.tsx` (DiagnosticsRoute와 동일 패턴 — 홈 Link + 화면):
```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { InventoryLookupScreen } from '../../domains/inventory/InventoryLookupScreen';

export function InventoryLookupRoute() {
  return (
    <div className="space-y-4">
      <Link to="/">
        <Button>← 홈</Button>
      </Link>
      <InventoryLookupScreen />
    </div>
  );
}
```

`src/app/routeTree.tsx` 수정 — `/inventory` 라우트를 실제 화면으로 교체:
```tsx
// 상단 import 추가:
import { InventoryLookupRoute } from './routes/InventoryLookupRoute';

// inventoryRoute 정의 교체:
const inventoryRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory',
  component: InventoryLookupRoute,
});
```
(`PlaceholderScreen` import는 다른 스텁 라우트에서 계속 쓰므로 유지.)

- [ ] **Step 11: 전체 테스트 + 빌드 + 린트**

Run: `npm run test && npm run build && npm run lint`
Expected: 전부 PASS.

- [ ] **Step 12: 커밋**

```bash
git add src/core/data/errorMessage.ts src/core/data/errorMessage.test.ts \
  src/domains/inventory/types.ts src/domains/inventory/useSkuSearch.ts \
  src/domains/inventory/InventoryLookupScreen.tsx \
  src/domains/inventory/InventoryLookupScreen.test.tsx \
  src/app/routes/InventoryLookupRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 재고조회 참조 화면 실제 API 배선 + 데이터훅 규약

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 완료 후 (선택) — 라이브 스모크

warehouse-app은 이미 OIDC 클라이언트로 등록돼 라이브 로그인이 동작한다. `.env.local`에 `VITE_API_BASE_URL`(+필요 시 `VITE_API_AUTH_MODE=bearer`)을 설정하고 `npm run tauri dev`로 실제 로그인 → 재고조회에서 상품명 검색이 실제 목록을 반환하는지 확인한다. (§13.1 토큰 수용 방식은 이 스모크로 실측 — Bearer가 통하면 `apiAuthMode` 기본값 전환을 후속 커밋으로.)

## Self-Review (작성자 체크 결과)

- **스펙 커버리지**: §2 허브+워크플로우내부스캔→Task1 · §3 조회공통/작업프로필별→Task1 허브 타일 구성 · §5 라우트 맵→Task1 routeTree · §6 재고조회 엔드포인트→Task3 useSkuSearch · §7 ApiClientProvider/도메인훅/errorMessage→Task2·3 · §9 테스트(목 트랜스포트)→각 Task 테스트. §4 컨텍스트 커맨드=비목표(플랜 없음, 의도적).
- **플레이스홀더 스캔**: 모든 코드 스텝에 실제 코드 포함. "TODO"/"적절히" 없음.
- **타입 일관성**: `SkuSearchItem`(Task3 정의)↔`useSkuSearch`↔화면 일치. `ApiClient`/`useApiClient`(Task2)↔`useSkuSearch`(Task3) 일치. `apiAuthMode`(Task2)↔`ApiClientProvider` 일치. `errorMessage`(Task3 정의)↔화면 일치.
- **주의**: 스펙 §6은 검색을 `search/advanced`로 적었으나, 파라미터가 확인되고 응답이 단순한 `GET /inventory/skus?name=`을 참조 화면에 채택(더 나은 복붙 원본). 상세(`/skus/:id/stock-summary`)는 스텁 유지.
```
