# 입고 일관성 최종 자동 검사 — 2026-09-16

기준 브랜치 `codex/inbound-workflow-consistency`, Task 8 시작 `57b52222b`. 각 표는 최종 JSON reporter의 파일별 assertion 결과에서 생성했다. 별도 focused 실행은 합산하지 않는다. 실패·skip 0은 아래 명령에 포함된 범위에 대한 결과이며 저장소 전체 서버 테스트를 뜻하지 않는다.

## 실행 명령과 환경

Node `v22.23.1`, Yarn `1.22.22`. `.env`를 로드하지 않고 아래 전용 로컬 DB를 명시했다. 마이그레이션 계약 suite의 `pr_c_t1_*` DB만 별도로 생성/삭제한다.

```bash
corepack yarn --cwd native/warehouse-app test --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=/tmp/inbound-task8-native-final.json
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/inbound_workflow_consistency_test corepack yarn test --runInBand --testPathPattern='(inbound-origin|inbound-receipt-state|inbound-putaway.reader|inbound-receipt-history|inbound-receipt.kernel|purchase-order-receiving|location-outbound|simple-outbound|batch-controlled-stock.guard|stocktaking-complete|stocktaking-count-version|warehouse-operation-auth|stocktaking.client|inbound.controllers|inbound-receipt-policy|inventory-idempotency.integration|move-dialog/error-message|inbound-workflow-http)' --json --outputFile=/tmp/inbound-task8-core-final.json
```

- Native: 89 files / 587 tests, 0 failures/skips/unhandled errors, 53.40 s. Worker 수만 제한했고 timeout은 늘리지 않았다.
- Core/관리자/감사/HTTP: 28 files / 419 tests, 0 failures/skips, 82.739 s. 실제 HTTP 3개, 감사33개를 포함한다.
- Native build: exit0, TypeScript 및 Vite 성공. JS 579.34 kB이며 기존 500 kB chunk 경고가 남는다.
- Core TypeScript: exit0, 6.56 s. Native lint: exit0, 오류0/기존 경고22.
- 원본 JSON/텍스트 로그: `/tmp/inbound-task8-{native,core}-final.{json,log}`, `/tmp/inbound-task8-{build,lint,core-tsc}.log`. 로그는 로컬 scratch이고 이 문서의 표가 추적되는 결과 기록이다.
- Core 로그에는 기존 서비스 LOG/DEBUG와 auth 실패 주입에서 발생하는 예상 ScopeGuard ERROR가 포함된다. 테스트 실패/skip으로 숨긴 것은 없으며 로그가 완전히 조용하다고 주장하지 않는다.

## Native 파일별 결과

파일 경로는 `native/warehouse-app/` 기준이다. JSON의 중첩 describe suite 수 대신 실제 `testResults` 파일 수를 사용한다.

| 파일 | 실행 | 실패 | skip |
|---|---:|---:|---:|
| `src/app/App.test.tsx` | 1 | 0 | 0 |
| `src/app/Bootstrap.test.tsx` | 1 | 0 | 0 |
| `src/app/guards.test.ts` | 4 | 0 | 0 |
| `src/app/profile.test.ts` | 4 | 0 | 0 |
| `src/app/router.handheld.test.tsx` | 3 | 0 | 0 |
| `src/app/router.test.tsx` | 6 | 0 | 0 |
| `src/app/routes/LoginScreen.test.tsx` | 3 | 0 | 0 |
| `src/app/session-context.test.tsx` | 1 | 0 | 0 |
| `src/app/warehouse-context.test.tsx` | 6 | 0 | 0 |
| `src/core/auth/login.test.ts` | 3 | 0 | 0 |
| `src/core/auth/oidc.test.ts` | 4 | 0 | 0 |
| `src/core/auth/pkce.test.ts` | 2 | 0 | 0 |
| `src/core/auth/session.test.ts` | 6 | 0 | 0 |
| `src/core/auth/tokenManager.test.ts` | 3 | 0 | 0 |
| `src/core/auth/tokenStore.test.ts` | 2 | 0 | 0 |
| `src/core/data/ApiClientProvider.test.tsx` | 2 | 0 | 0 |
| `src/core/data/authHeader.test.ts` | 2 | 0 | 0 |
| `src/core/data/devicePrefs.test.ts` | 4 | 0 | 0 |
| `src/core/data/errorMessage.test.ts` | 26 | 0 | 0 |
| `src/core/data/httpClient.test.ts` | 6 | 0 | 0 |
| `src/core/data/httpScope.test.ts` | 3 | 0 | 0 |
| `src/core/design/ConfirmDialog.test.tsx` | 11 | 0 | 0 |
| `src/core/design/DataTable.test.tsx` | 5 | 0 | 0 |
| `src/core/design/HubTile.test.tsx` | 1 | 0 | 0 |
| `src/core/design/NumberPad.test.tsx` | 7 | 0 | 0 |
| `src/core/design/PlaceholderScreen.test.tsx` | 1 | 0 | 0 |
| `src/core/design/QuantityInput.test.tsx` | 1 | 0 | 0 |
| `src/core/design/ScreenHeader.test.tsx` | 2 | 0 | 0 |
| `src/core/diagnostics/operationDiagnostics.test.ts` | 1 | 0 | 0 |
| `src/core/hardware/print/zpl.test.ts` | 1 | 0 | 0 |
| `src/core/hardware/scan/BarcodeInput.test.tsx` | 1 | 0 | 0 |
| `src/core/hardware/scan/ScanProvider.test.tsx` | 3 | 0 | 0 |
| `src/core/hardware/scan/scanBuffer.test.ts` | 6 | 0 | 0 |
| `src/core/hardware/scan/useWorkScanQueue.test.tsx` | 3 | 0 | 0 |
| `src/core/hardware/scan/workScanQueue.test.ts` | 3 | 0 | 0 |
| `src/core/operations/operationResult.test.ts` | 5 | 0 | 0 |
| `src/core/operations/operationRunner.test.ts` | 44 | 0 | 0 |
| `src/core/operations/operationStore.test.ts` | 3 | 0 | 0 |
| `src/core/operations/workStatus.test.ts` | 1 | 0 | 0 |
| `src/domains/inbound/ExpectedArrivalListScreen.test.tsx` | 4 | 0 | 0 |
| `src/domains/inbound/InboundHistoryScreen.test.tsx` | 3 | 0 | 0 |
| `src/domains/inbound/InboundWorkflow.runtime.test.tsx` | 8 | 0 | 0 |
| `src/domains/inbound/PurchaseOrderReceiveScreen.runtime.test.tsx` | 41 | 0 | 0 |
| `src/domains/inbound/PurchaseOrderReceiveScreen.test.tsx` | 15 | 0 | 0 |
| `src/domains/inbound/PutawayQueueScreen.test.tsx` | 28 | 0 | 0 |
| `src/domains/inbound/PutawaySheet.test.tsx` | 13 | 0 | 0 |
| `src/domains/inbound/QuickInboundScreen.test.tsx` | 9 | 0 | 0 |
| `src/domains/inbound/ReceiveSheet.test.tsx` | 3 | 0 | 0 |
| `src/domains/inbound/ReliabilityReview.test.tsx` | 9 | 0 | 0 |
| `src/domains/inbound/mutations.test.tsx` | 8 | 0 | 0 |
| `src/domains/inbound/packingUnit.test.ts` | 5 | 0 | 0 |
| `src/domains/inbound/poReceiveDraft.test.ts` | 23 | 0 | 0 |
| `src/domains/inbound/putawaySearch.test.ts` | 1 | 0 | 0 |
| `src/domains/inbound/queries.test.tsx` | 6 | 0 | 0 |
| `src/domains/inbound/receiptHistory.test.tsx` | 6 | 0 | 0 |
| `src/domains/inbound/receiptState.test.tsx` | 15 | 0 | 0 |
| `src/domains/inbound/useReceiptReconciliation.test.tsx` | 20 | 0 | 0 |
| `src/domains/inventory/AdjustStockScreen.test.tsx` | 14 | 0 | 0 |
| `src/domains/inventory/InventoryLookupScreen.test.tsx` | 12 | 0 | 0 |
| `src/domains/inventory/SkuDetailScreen.test.tsx` | 5 | 0 | 0 |
| `src/domains/inventory/SkuPicker.test.tsx` | 1 | 0 | 0 |
| `src/domains/inventory/StockCell.test.tsx` | 4 | 0 | 0 |
| `src/domains/inventory/useAdjustStock.test.tsx` | 1 | 0 | 0 |
| `src/domains/inventory/useSkuByBarcode.test.tsx` | 3 | 0 | 0 |
| `src/domains/inventory/useSkuDetail.test.tsx` | 4 | 0 | 0 |
| `src/domains/inventory/useSkuSearch.test.tsx` | 2 | 0 | 0 |
| `src/domains/movement/MovementScreen.test.tsx` | 13 | 0 | 0 |
| `src/domains/movement/useLocationContents.test.tsx` | 2 | 0 | 0 |
| `src/domains/movement/useMoveStock.test.tsx` | 2 | 0 | 0 |
| `src/domains/outbound/LocationOutboundScreen.runtime.test.tsx` | 23 | 0 | 0 |
| `src/domains/outbound/LocationOutboundScreen.test.tsx` | 6 | 0 | 0 |
| `src/domains/outbound/OutboundQueueScreen.test.tsx` | 11 | 0 | 0 |
| `src/domains/outbound/ReliabilityReview.test.tsx` | 1 | 0 | 0 |
| `src/domains/outbound/SimpleOutboundScreen.test.tsx` | 8 | 0 | 0 |
| `src/domains/outbound/lastBox.test.ts` | 3 | 0 | 0 |
| `src/domains/outbound/mutations.test.tsx` | 2 | 0 | 0 |
| `src/domains/outbound/queries.test.tsx` | 3 | 0 | 0 |
| `src/domains/stocktaking/AddCountItemSheet.test.tsx` | 2 | 0 | 0 |
| `src/domains/stocktaking/ReliabilityReview.test.tsx` | 1 | 0 | 0 |
| `src/domains/stocktaking/SessionCountScreen.test.tsx` | 18 | 0 | 0 |
| `src/domains/stocktaking/SessionListScreen.test.tsx` | 6 | 0 | 0 |
| `src/domains/stocktaking/VarianceReviewScreen.test.tsx` | 9 | 0 | 0 |
| `src/domains/stocktaking/mutations.test.tsx` | 9 | 0 | 0 |
| `src/domains/stocktaking/queries.test.tsx` | 5 | 0 | 0 |
| `src/domains/warehouse/WarehousePicker.test.tsx` | 3 | 0 | 0 |
| `src/domains/warehouse/useLocationSearch.test.tsx` | 3 | 0 | 0 |
| `src/domains/warehouse/useWarehouses.test.tsx` | 1 | 0 | 0 |
| `src/example.test.ts` | 1 | 0 | 0 |
| `src/profiles/shared/DiagnosticsScreen.test.tsx` | 1 | 0 | 0 |

## Core·관리자·감사·HTTP 파일별 결과

파일 경로는 저장소 루트 기준이다.

| 파일 | 실행 | 실패 | skip |
|---|---:|---:|---:|
| `apps/admin-web/src/features/inventory/movement/components/move-dialog/error-message.spec.ts` | 2 | 0 | 0 |
| `apps/admin-web/src/lib/api/domains/inventory/stocktaking.client.spec.ts` | 34 | 0 | 0 |
| `apps/core/src/modules/fulfillment/controllers/location-outbound.controller.spec.ts` | 16 | 0 | 0 |
| `apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts` | 6 | 0 | 0 |
| `apps/core/src/modules/fulfillment/controllers/simple-outbound.route-order.spec.ts` | 2 | 0 | 0 |
| `apps/core/src/modules/fulfillment/services/inbound-origin-planning.integration.spec.ts` | 17 | 0 | 0 |
| `apps/core/src/modules/fulfillment/services/location-outbound.service.integration.spec.ts` | 29 | 0 | 0 |
| `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts` | 19 | 0 | 0 |
| `apps/core/src/modules/inventory/core/controllers/inbound-workflow-http.integration.spec.ts` | 3 | 0 | 0 |
| `apps/core/src/modules/inventory/core/controllers/warehouse-operation-auth.spec.ts` | 26 | 0 | 0 |
| `apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.integration.spec.ts` | 6 | 0 | 0 |
| `apps/core/src/modules/inventory/core/services/inbound-origin-protection.concurrency.integration.spec.ts` | 6 | 0 | 0 |
| `apps/core/src/modules/inventory/core/services/inbound-origin-protection.integration.spec.ts` | 23 | 0 | 0 |
| `apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts` | 9 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.spec.ts` | 47 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts` | 11 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts` | 16 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/services/inbound-receipt-history.integration.spec.ts` | 6 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/services/inbound-receipt-policy.spec.ts` | 18 | 0 | 0 |
| `apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.integration.spec.ts` | 18 | 0 | 0 |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.concurrency.integration.spec.ts` | 4 | 0 | 0 |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.integration.spec.ts` | 19 | 0 | 0 |
| `apps/core/src/modules/inventory/schema/purchase-order-receiving-backfill-guard.integration.spec.ts` | 9 | 0 | 0 |
| `apps/core/src/modules/inventory/schema/purchase-order-receiving-contract.integration.spec.ts` | 12 | 0 | 0 |
| `apps/core/src/modules/inventory/shared/availability/inbound-origin-availability.integration.spec.ts` | 18 | 0 | 0 |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking-complete.integration.spec.ts` | 4 | 0 | 0 |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking-count-version.integration.spec.ts` | 6 | 0 | 0 |
| `scripts/inventory/audit-inbound-origin-consistency.integration.spec.ts` | 33 | 0 | 0 |

## 보존한 기존 lint 경고22개

수정 전 기준선과 다음 파일별 경고 수가 같다. Hook 의존성과 Fast Refresh export 경고다. 새로 생긴 `setDest` 의존성2개는 이미 안정된 callback을 deps에 포함했고, request generation은 cleanup에서 최신 counter를 무효화하도록 안정된 ref 객체를 캡처했다. 테스트 전용 fixture의 혼합 export2개는 해당 fixture에만 설명을 붙여 Fast Refresh 규칙에서 제외했다. 제품 파일 전체 규칙이나 전역 경고 제한은 낮추지 않았다.

| 파일 (`native/warehouse-app/` 기준) | 경고 수 |
|---|---:|
| `src/app/session-context.tsx` | 2 |
| `src/app/warehouse-context.tsx` | 1 |
| `src/core/data/ApiClientProvider.tsx` | 2 |
| `src/core/design/QuantityInput.tsx` | 1 |
| `src/core/diagnostics/DeveloperModeProvider.tsx` | 2 |
| `src/core/hardware/scan/ScanProvider.tsx` | 1 |
| `src/core/operations/WorkBoundary.tsx` | 1 |
| `src/core/operations/useWorkDraft.ts` | 2 |
| `src/domains/inbound/PurchaseOrderReceiveScreen.tsx` | 1 |
| `src/domains/inbound/QuickInboundScreen.tsx` | 1 |
| `src/domains/inventory/AdjustStockScreen.tsx` | 2 |
| `src/domains/outbound/LocationOutboundScreen.tsx` | 1 |
| `src/domains/stocktaking/AddCountItemSheet.tsx` | 1 |
| `src/domains/stocktaking/SessionCountScreen.tsx` | 2 |
| `src/domains/stocktaking/VarianceReviewScreen.tsx` | 2 |

## 실패 기록과 재검증

- 최초 controller RED: 새 capability 부재로 1실패/25통과. 실제 HTTP RED: capability 부재로 1실패/2통과. 공개 후 두 suite 29/29통과.
- 최초 전체 Native(부모 검증): 586/587 통과 및 deferred 404 unhandled rejection 1건. 실제 버튼 준비/GET 소비 시작을 기다리는 테스트 수정 후 focused64개와 최종 전체587개 통과.
- focused 보강 중 오류 문구 assertion과 일시적으로 교체된 PO 안내 DOM assertion 실패도 확인했다. 실제 HTTP 형식의 오류 문구와 표시된 DOM을 기다리도록 테스트를 수정했고 최종 focused64개/전체587개에서 재검증했다.
- 최초 전체 Core: 418/419 통과, 기존 migration journal `before + 2` 기대값 오류1건. 이미 존재하던 stocktaking baseline을 포함하는 현재 적용 목록을 hash/timestamp 및 기존 prefix 보존으로 검증하도록 강화했다. 변경 후 migration12개/최종 전체419개 통과. 스키마·migration chain은 변경하지 않았다.
- 실제 Windows/PDA, HID 장비, OS 프로세스 강제 종료, 실제 Wi-Fi·로그인은 미검증이다. 브라우저 화면은 읽기 전용 API fixture이며 실제 HTTP/DB 검사와 분리한다.

전체 인수와 A1–A12 및 화면 캡처는 [인수 기록](../../inventory-accuracy-acceptance.md#2026-09-16-입고-대기-보호와-현재-상태-일관성)을 따른다.
