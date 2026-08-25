import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { INVENTORY_SCOPE, type InventoryScope } from './inventory-scopes';

/**
 * inventory 라우트 ↔ 스코프 배정표.
 *
 * 왜 전수 표인가 — #551 을 만든 원인은 전수조사가 사람 손 글롭이었다는 것이다. 이슈 본문의
 * `find -name "*.controller.ts"` 가 `inbound.controllers.ts`(복수형)를 통째로 놓쳐 쓰기
 * 11개가 조사에서 빠졌다. 이 스펙은 AST 로 라우트를 뽑아 표와 **양방향** 대조하므로,
 * 표에 없는 새 라우트도 표에만 있고 코드에서 사라진 라우트도 실패로 잡힌다.
 *
 * 스코프 판단 없이 라우트를 추가할 수 없다 — 그게 이 파일의 목적이다.
 *
 * `null` = 의도적 무표시. 표시가 없으면 `AdminRealmGuard`(전역)가 `admin`/`master` 로 계속
 * 지키므로, 진단·내부 조회 전용 라우트에는 그게 올바른 기본값이다.
 *
 * `@RequireScopes` ↔ `ScopeGuard` 바인딩은 `scope-guard-binding.spec.ts` 가 core 전역으로
 * 검사한다 — 여기서 중복하지 않는다.
 */
const INVENTORY_DIR = join(__dirname, '..', '..', 'modules', 'inventory');
const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);

const S = INVENTORY_SCOPE;

const ROUTE_SCOPES: Record<string, InventoryScope | null> = {
  // ── inventory.operate (69) ──────────────────────────────────────────
  'GET /holders':                                            S.OPERATE,
  'GET /holders/:id':                                        S.OPERATE,
  'POST /inbound/cancel':                                    S.OPERATE,
  'GET /inbound/history':                                    S.OPERATE,
  'POST /inbound/individual':                                S.OPERATE,
  'POST /inbound/lines/:lineId/memo':                        S.OPERATE,
  'GET /inbound/pending':                                    S.OPERATE,
  'GET /inbound/plans/items':                                S.OPERATE,
  'POST /inbound/plans/receive':                             S.OPERATE,
  'POST /inbound/putaway':                                   S.OPERATE,
  'GET /inbound/putaway/pending':                            S.OPERATE,
  'GET /inbound/receipts':                                   S.OPERATE,
  'POST /inbound/return':                                    S.OPERATE,
  'POST /inbound/simple':                                    S.OPERATE,
  'POST /inbound/simple-fullscan':                           S.OPERATE,
  'GET /inbound/status':                                     S.OPERATE,
  'POST /inbound/verify-barcode':                            S.OPERATE,
  'GET /inbound/work-logs':                                  S.OPERATE,
  'GET /inventory/managers/:managerId/skus':                 S.OPERATE,
  'GET /inventory/reservations/by-sku/:skuId':               S.OPERATE,
  'GET /inventory/reservations/by-target':                   S.OPERATE,
  'GET /inventory/reservations/summary/:warehouseId':        S.OPERATE,
  'GET /inventory/returns':                                  S.OPERATE,
  'GET /inventory/returns/:id':                              S.OPERATE,
  'GET /inventory/safety-stock-status/:skuId':               S.OPERATE,
  'GET /inventory/safety-stock-warnings':                    S.OPERATE,
  'GET /inventory/sku-groups':                               S.OPERATE,
  'GET /inventory/sku-groups/:id':                           S.OPERATE,
  'GET /inventory/sku-groups/:id/members':                   S.OPERATE,
  'GET /inventory/sku-groups/ungrouped':                     S.OPERATE,
  'GET /inventory/skus':                                     S.OPERATE,
  'GET /inventory/skus/:id':                                 S.OPERATE,
  'GET /inventory/skus/:id/stock-summary':                   S.OPERATE,
  'GET /inventory/skus/:skuId/managers':                     S.OPERATE,
  'GET /inventory/skus/deleted':                             S.OPERATE,
  'GET /inventory/skus/managers/all':                        S.OPERATE,
  'GET /inventory/skus/search/advanced':                     S.OPERATE,
  'GET /inventory/stocks':                                   S.OPERATE,
  'GET /inventory/stocks/history':                           S.OPERATE,
  'GET /inventory/stocks/inbound-pipeline':                  S.OPERATE,
  'GET /inventory/stocks/location/:locationId':              S.OPERATE,
  'GET /inventory/stocks/sku/:skuId/total':                  S.OPERATE,
  'GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId': S.OPERATE,
  'GET /inventory/stocks/summary':                           S.OPERATE,
  'GET /inventory/transfers':                                S.OPERATE,
  'GET /inventory/transfers/:id':                            S.OPERATE,
  'GET /inventory/transfers/:id/status':                     S.OPERATE,
  'POST /inventory/transfers/move-within-warehouse':         S.OPERATE,
  'GET /inventory/warehouse-transfers/outstanding':          S.OPERATE,
  'GET /inventory/warehouses':                               S.OPERATE,
  'GET /inventory/warehouses/:id':                           S.OPERATE,
  'GET /inventory/warehouses/:id/summary':                   S.OPERATE,
  'GET /locations/:locationId':                              S.OPERATE,
  'GET /locations/warehouses/:warehouseId':                  S.OPERATE,
  'GET /locations/warehouses/:warehouseId/columns':          S.OPERATE,
  'GET /locations/warehouses/:warehouseId/racks':            S.OPERATE,
  'GET /movement/history':                                   S.OPERATE,
  'GET /movement/jobs/:jobId':                               S.OPERATE,
  'POST /movement/move':                                     S.OPERATE,
  'PUT /stocktaking/lines/:id/count':                        S.OPERATE,
  'POST /stocktaking/scan-location':                         S.OPERATE,
  'POST /stocktaking/scan-product':                          S.OPERATE,
  'GET /stocktaking/sessions':                               S.OPERATE,
  'POST /stocktaking/sessions':                              S.OPERATE,
  'GET /stocktaking/sessions/:id':                           S.OPERATE,
  'POST /stocktaking/sessions/:id/cancel':                   S.OPERATE,
  'POST /stocktaking/sessions/:id/generate-adjustments':     S.OPERATE,
  'POST /stocktaking/sessions/:id/start':                    S.OPERATE,
  'GET /stocktaking/sessions/:id/variances':                 S.OPERATE,

  // ── inventory.manage (60) ──────────────────────────────────────────
  'POST /barcode-generation/custom':                           S.MANAGE,
  'POST /barcode-generation/fulfillment-order':                S.MANAGE,
  'POST /barcode-generation/location':                         S.MANAGE,
  'POST /barcode-generation/sku':                              S.MANAGE,
  'POST /barcode-generation/validate':                         S.MANAGE,
  'POST /holders':                                             S.MANAGE,
  'DELETE /holders/:id':                                       S.MANAGE,
  'PUT /holders/:id':                                          S.MANAGE,
  'POST /inbound/plans':                                       S.MANAGE,
  'POST /inbound/plans/items':                                 S.MANAGE,
  'POST /inventory/sku-groups':                                S.MANAGE,
  'DELETE /inventory/sku-groups/:id':                          S.MANAGE,
  'PUT /inventory/sku-groups/:id':                             S.MANAGE,
  'POST /inventory/sku-groups/:id/members':                    S.MANAGE,
  'POST /inventory/sku-groups/:id/members/bulk':               S.MANAGE,
  'DELETE /inventory/sku-groups/members/:skuId':               S.MANAGE,
  'POST /inventory/skus':                                      S.MANAGE,
  'DELETE /inventory/skus/:id':                                S.MANAGE,
  'PUT /inventory/skus/:id':                                   S.MANAGE,
  'POST /inventory/skus/:id/barcodes':                         S.MANAGE,
  'DELETE /inventory/skus/:id/barcodes/:barcodeId':            S.MANAGE,
  'PATCH /inventory/skus/:id/restore':                         S.MANAGE,
  'DELETE /inventory/skus/:skuId/managers':                    S.MANAGE,
  'PUT /inventory/skus/:skuId/managers':                       S.MANAGE,
  'DELETE /inventory/skus/:skuId/managers/:role':              S.MANAGE,
  'POST /inventory/skus/managers':                             S.MANAGE,
  'PUT /locations/:locationId':                                S.MANAGE,
  'PUT /locations/columns/:columnId':                          S.MANAGE,
  'PUT /locations/racks/:rackId':                              S.MANAGE,
  'POST /locations/warehouses/:warehouseId/columns':           S.MANAGE,
  'POST /locations/warehouses/:warehouseId/racks':             S.MANAGE,
  'POST /locations/warehouses/:warehouseId/racks/custom-bins': S.MANAGE,
  'POST /locations/warehouses/:warehouseId/zones':             S.MANAGE,
  'GET /purchase-orders':                                      S.MANAGE,
  'POST /purchase-orders':                                     S.MANAGE,
  'GET /purchase-orders/:id':                                  S.MANAGE,
  'PUT /purchase-orders/:id/approve':                          S.MANAGE,
  'PUT /purchase-orders/:id/lines':                            S.MANAGE,
  'PUT /purchase-orders/:id/reject':                           S.MANAGE,
  'PUT /purchase-orders/:id/status':                           S.MANAGE,
  'PUT /purchase-orders/:id/submit-for-audit':                 S.MANAGE,
  'POST /purchase-orders/:poId/lines/:skuId/order':            S.MANAGE,
  'POST /purchase-orders/:poId/lines/:skuId/unavailable':      S.MANAGE,
  'DELETE /purchase-orders/cart':                              S.MANAGE,
  'GET /purchase-orders/cart':                                 S.MANAGE,
  'POST /purchase-orders/cart':                                S.MANAGE,
  'DELETE /purchase-orders/cart/:itemId':                      S.MANAGE,
  'PUT /purchase-orders/cart/:itemId':                         S.MANAGE,
  'POST /purchase-orders/from-cart':                           S.MANAGE,
  'GET /purchase-orders/suggestions/reorder':                  S.MANAGE,
  'GET /supplier-categories':                                  S.MANAGE,
  'POST /supplier-categories':                                 S.MANAGE,
  'DELETE /supplier-categories/:id':                           S.MANAGE,
  'GET /supplier-categories/:id':                              S.MANAGE,
  'PUT /supplier-categories/:id':                              S.MANAGE,
  'GET /suppliers':                                            S.MANAGE,
  'POST /suppliers':                                           S.MANAGE,
  'DELETE /suppliers/:id':                                     S.MANAGE,
  'GET /suppliers/:id':                                        S.MANAGE,
  'PUT /suppliers/:id':                                        S.MANAGE,

  // ── inventory.adjust (17) ──────────────────────────────────────────
  'DELETE /inventory/reservations/:id':                         S.ADJUST,
  'POST /inventory/reservations/reconcile':                     S.ADJUST,
  'POST /inventory/returns':                                    S.ADJUST,
  'PATCH /inventory/returns/:id/inspect':                       S.ADJUST,
  'PATCH /inventory/returns/:id/process':                       S.ADJUST,
  'PATCH /inventory/returns/:id/receive':                       S.ADJUST,
  'POST /inventory/stocks/adjust':                              S.ADJUST,
  'POST /inventory/stocks/entry-safe':                          S.ADJUST,
  'DELETE /inventory/stocks/events/:eventId/cancel':            S.ADJUST,
  'POST /inventory/stocks/summary/:skuId/:warehouseId/rebuild': S.ADJUST,
  'POST /inventory/transfers':                                  S.ADJUST,
  'PATCH /inventory/transfers/:id/execute':                     S.ADJUST,
  'POST /inventory/warehouse-transfers':                        S.ADJUST,
  'PATCH /inventory/warehouse-transfers/:id/eta':               S.ADJUST,
  'POST /inventory/warehouse-transfers/:id/receipts':           S.ADJUST,
  'POST /inventory/warehouse-transfers/:id/ship':               S.ADJUST,
  'POST /stocktaking/sessions/:id/complete':                    S.ADJUST,

  // ── inventory.warehouse.manage (3) ──────────────────────────────────────────
  'POST /inventory/warehouses':       S.WAREHOUSE_MANAGE,
  'DELETE /inventory/warehouses/:id': S.WAREHOUSE_MANAGE,
  'PATCH /inventory/warehouses/:id':  S.WAREHOUSE_MANAGE,

  // ── 무표시 유지 (7) ──────────────────────────────────────────
  'GET /inventory/health':                                          null,
  'GET /inventory/health/detailed':                                 null,
  'GET /inventory/health/live':                                     null,
  'GET /inventory/health/ready':                                    null,
  'GET /inventory/ledger-reconciliation':                           null,
  'GET /inventory/ledger-reconciliation/reservations':              null,
  'GET /inventory/product-sellable-quantities/variants/:variantId': null,
};

/** AST 는 식의 원문만 준다. 값으로 되돌리는 유일한 통로. */
const SCOPE_BY_EXPRESSION: Record<string, InventoryScope> = {
  'INVENTORY_SCOPE.OPERATE': S.OPERATE,
  'INVENTORY_SCOPE.MANAGE': S.MANAGE,
  'INVENTORY_SCOPE.ADJUST': S.ADJUST,
  'INVENTORY_SCOPE.WAREHOUSE_MANAGE': S.WAREHOUSE_MANAGE,
};

interface Route {
  key: string;
  /** 그 핸들러에 걸린 `@RequireScopes` 인자들의 원문. */
  expressions: string[];
}

interface DecoratorInfo {
  name: string;
  args: string[];
}

/**
 * 모든 `.ts` 를 넘긴다 — 파일 이름으로 컨트롤러를 고르지 않는다.
 *
 * #551 자체가 이름 판정의 산물이었다: `*.controller.ts` 글롭이 `inbound.controllers.ts`
 * (복수형)를 놓쳤다. 여기서 다시 이름으로 거르면 같은 사각지대를 한 층 아래에 재현한다.
 * 판정은 `collectRoutes` 가 한다 — `@Controller` 클래스가 없는 파일은 빈 배열을 돌려주므로
 * 이름이 무엇이든 라우트 집합은 달라지지 않는다.
 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function decoratorsOf(node: ts.Node): DecoratorInfo[] {
  return (ts.getDecorators(node as ts.HasDecorators) ?? []).map((decorator) => {
    const expression = decorator.expression;
    return ts.isCallExpression(expression)
      ? { name: expression.expression.getText(), args: expression.arguments.map((arg) => arg.getText()) }
      : { name: expression.getText(), args: [] };
  });
}

const literal = (arg: string | undefined): string =>
  arg !== undefined && /^['"`]/.test(arg) ? arg.slice(1, -1) : '';

function collectRoutes(file: string): Route[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const routes: Route[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const classDecorators = decoratorsOf(node);
      const controller = classDecorators.find((decorator) => decorator.name === 'Controller');

      if (controller) {
        const base = literal(controller.args[0]);
        const classScopes = classDecorators.filter((decorator) => decorator.name === 'RequireScopes');

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decorators = decoratorsOf(member);
          const route = decorators.find((decorator) => HTTP_METHODS.has(decorator.name));
          if (!route) continue;

          const path = `/${base}/${literal(route.args[0])}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          const scopeDecorators = [
            ...classScopes,
            ...decorators.filter((decorator) => decorator.name === 'RequireScopes'),
          ];

          routes.push({
            key: `${route.name.toUpperCase()} ${path}`,
            expressions: scopeDecorators.flatMap((decorator) => decorator.args),
          });
        }
      }
    }
    node.forEachChild(visit);
  };

  source.forEachChild(visit);
  return routes;
}

/** 표와 비교 가능한 값. `undefined` 는 "해석 불가" — 별도 테스트가 잡는다. */
function resolveScope(route: Route): InventoryScope | null | undefined {
  if (route.expressions.length === 0) return null;
  if (route.expressions.length > 1) return undefined;
  return SCOPE_BY_EXPRESSION[route.expressions[0]];
}

describe('core inventory: 라우트 스코프 배정 커버리지', () => {
  const scanned = collectSourceFiles(INVENTORY_DIR).map((file) => ({ file, routes: collectRoutes(file) }));
  const routes = scanned.flatMap((entry) => entry.routes);
  const filesWithRoutes = scanned.filter((entry) => entry.routes.length > 0);

  // 하한은 "스캔한 .ts 개수" 가 아니라 **라우트가 실제로 나온 파일 수** 에 건다. 전자는
  // 컨트롤러가 한 개도 안 잡혀도 통과하는 공허한 단언이 된다.
  it('컨트롤러 파일을 실제로 수집한다 (수집 실패로 인한 위양성 방지)', () => {
    expect(filesWithRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it('표와 코드의 라우트 집합이 정확히 일치한다', () => {
    const inCode = new Set(routes.map((route) => route.key));
    const inTable = new Set(Object.keys(ROUTE_SCOPES));

    const missingFromTable = [...inCode].filter((key) => !inTable.has(key)).sort();
    const staleInTable = [...inTable].filter((key) => !inCode.has(key)).sort();

    expect({ missingFromTable, staleInTable }).toEqual({ missingFromTable: [], staleInTable: [] });
  });

  it('모든 @RequireScopes 인자가 알려진 스코프 식이다', () => {
    const unresolved = routes
      .filter((route) => route.expressions.length > 0 && resolveScope(route) === undefined)
      .map((route) => `${route.key} → ${route.expressions.join(', ')}`)
      .sort();

    expect(unresolved).toEqual([]);
  });

  it('모든 라우트의 스코프가 배정표와 일치한다', () => {
    const mismatches = routes
      .filter((route) => route.key in ROUTE_SCOPES)
      .filter((route) => resolveScope(route) !== ROUTE_SCOPES[route.key])
      .map((route) => `${route.key}: 표=${ROUTE_SCOPES[route.key] ?? '무표시'} 코드=${resolveScope(route) ?? '무표시'}`)
      .sort();

    expect(mismatches).toEqual([]);
  });

  // 무표시는 "아직 안 붙인 것" 이 아니라 결론이다. 이 수가 늘어나면 누군가 스코프 부착을
  // 건너뛰고 표에 null 을 적었다는 뜻이다 — 늘리려면 이 테스트를 고치면서 사유를 적어야 한다.
  it('의도적 무표시는 정확히 7개이며 전부 진단·내부 조회 전용이다', () => {
    const unscoped = Object.entries(ROUTE_SCOPES)
      .filter(([, scope]) => scope === null)
      .map(([key]) => key)
      .sort();

    expect(unscoped).toEqual([
      // 로드밸런서·ECS 헬스체크. `/health`·`/health/live`·`/health/ready` 는 @Public 이라 인증
      // 자체가 면제된다. `/health/detailed` 는 @Public 이 아니다 — AdminRealmGuard 가 admin/master
      // 로 막는 진단용 엔드포인트라 나머지 셋보다 보호 수준이 높고, 아래 두 항목과 같은 계열이다.
      'GET /inventory/health',
      'GET /inventory/health/detailed',
      'GET /inventory/health/live',
      'GET /inventory/health/ready',
      // 원장 드리프트 탐지 전용 읽기. HTTP 호출자 0건 (저장소 전수 grep)
      'GET /inventory/ledger-reconciliation',
      'GET /inventory/ledger-reconciliation/reservations',
      // 판매가능수량 조회. HTTP 호출자 0건 (저장소 전수 grep)
      'GET /inventory/product-sellable-quantities/variants/:variantId',
    ]);
  });
});
