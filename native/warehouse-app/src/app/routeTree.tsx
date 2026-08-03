import {
  createRootRouteWithContext,
  createRoute,
  redirect,
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
import { QuickInboundRoute } from './routes/QuickInboundRoute';
import { PutawayRoute } from './routes/PutawayRoute';
import { OutboundRoute } from './routes/OutboundRoute';
import { SimpleOutboundRoute } from './routes/SimpleOutboundRoute';
import type { ShipmentByWaybill } from '../domains/outbound/types';

export interface RouterContext {
  session: Session;
}

// 큐 화면(`OutboundQueueScreen`)이 by-waybill 조회 결과를 `navigate({ state })`
// 로 단순출고 화면에 실어 보낸다 — 화면이 shipmentId 만으로 다시 조회할 별도
// API 가 없으므로, 이 라운드트립이 유일한 라인 소스다(딥링크/새로고침이면
// state 가 비어 화면이 재스캔을 안내한다).
declare module '@tanstack/history' {
  interface HistoryState {
    shipment?: ShipmentByWaybill;
  }
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
const inboundPlanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/plans/$planId',
  component: PlanReceiveRoute,
});
const inboundQuickRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/quick',
  component: QuickInboundRoute,
});
const pickingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/picking',
  beforeLoad: () => {
    throw redirect({ to: '/outbound' });
  },
});
const putawayRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/putaway',
  component: PutawayRoute,
});

// --- 작업 · 스테이션 ---
const packingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/packing',
  beforeLoad: () => {
    throw redirect({ to: '/outbound' });
  },
});

// --- 작업 · 출고(피킹+패킹 통합) ---
const outboundRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound',
  component: OutboundRoute,
});
const outboundSimpleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound/simple/$shipmentId',
  component: SimpleOutboundRoute,
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
    putawayRoute,
    packingRoute,
    outboundRoute,
    outboundSimpleRoute,
    settingsRoute,
  ]),
]);
