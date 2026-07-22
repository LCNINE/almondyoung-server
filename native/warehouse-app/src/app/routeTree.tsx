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
import { InventoryLookupRoute } from './routes/InventoryLookupRoute';
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

// --- 조회 ---
const inventoryRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory',
  component: InventoryLookupRoute,
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
