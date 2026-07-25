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
import { SettingsRoute } from './routes/SettingsRoute';
import { PlaceholderScreen } from '../core/design/PlaceholderScreen';
import { SkuDetailRoute } from './routes/SkuDetailRoute';
import { AdjustStockRoute } from './routes/AdjustStockRoute';
import { StocktakingRoute } from './routes/StocktakingRoute';
import { StocktakingSessionRoute } from './routes/StocktakingSessionRoute';
import { StocktakingVariancesRoute } from './routes/StocktakingVariancesRoute';
import { MovementRoute } from './routes/MovementRoute';
import { InboundRoute } from './routes/InboundRoute';
import { PlanReceiveRoute } from './routes/PlanReceiveRoute';

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
  component: SkuDetailRoute,
});
const inventoryAdjustRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory/$sku/adjust',
  component: AdjustStockRoute,
  validateSearch: (search: Record<string, unknown>): { locationId?: string } => ({
    locationId: typeof search.locationId === 'string' ? search.locationId : undefined,
  }),
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
  component: StocktakingRoute,
});
const stocktakingSessionRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId',
  component: StocktakingSessionRoute,
});
const stocktakingVariancesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId/variances',
  component: StocktakingVariancesRoute,
});
const movementRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/movement',
  component: MovementRoute,
});
const inboundRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound',
  component: InboundRoute,
});
// Task 9 가 실제 화면으로 대체할 자리표시자 — PendingPlanListScreen 이 이 경로로
// typed <Link to=...> 를 걸기 때문에, 라우트 등록 없이는 빌드 타입체크가 깨진다.
// 화면 구현 없이 경로만 먼저 연다.
const inboundQuickRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/quick',
  component: () => <PlaceholderScreen title="간편입고" note="Task 9에서 구현됩니다." />,
});
const inboundPlanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/plans/$planId',
  component: PlanReceiveRoute,
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
  component: SettingsRoute,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([
    indexRoute,
    diagnosticsRoute,
    inventoryRoute,
    inventoryDetailRoute,
    inventoryAdjustRoute,
    shipmentsRoute,
    stocktakingRoute,
    stocktakingSessionRoute,
    stocktakingVariancesRoute,
    movementRoute,
    inboundRoute,
    inboundPlanRoute,
    inboundQuickRoute,
    pickingRoute,
    packingRoute,
    settingsRoute,
  ]),
]);
