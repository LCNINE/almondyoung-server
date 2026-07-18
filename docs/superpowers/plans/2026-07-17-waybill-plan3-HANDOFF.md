# 운송장(waybill) 재설계 — 플랜 3(컷오버) 핸드오프

- 작성: 2026-07-17 (플랜 2 완료 직후)
- 브랜치: `feat/waybill-module-redesign` (tip `e2cda3ce1`, develop 대비 +36 커밋, **미머지**)
- 목적: 플랜 1(캐리어층)·플랜 2(도메인층) 완료 후, **플랜 3(소비자 컷오버 + 구 invoice 삭제)** 를 다른 세션에서 이어받기 위한 상태·seam 계약·rewire 맵·주의.

## 0. 먼저 읽을 것

| 문서 | 내용 |
|------|------|
| `docs/superpowers/specs/2026-07-17-waybill-module-redesign-design.md` | 설계 SoT. **§12 = 플랜 3(consumer 마이그레이션)**. §3.1 확정결정, §9 seam. |
| `docs/superpowers/plans/2026-07-17-waybill-domain-layer.md` | 플랜 2(도메인층) — 구현된 코드의 형태·근거 |
| `.superpowers/sdd/progress.md` | 플랜 1·2 SDD 실행 원장(태스크별 리뷰·fix·교훈). git-ignored |
| (auto-memory) `waybill-module-redesign` | 세션 간 요약 |
| 구 핸드오프 `2026-07-17-waybill-redesign-HANDOFF.md` | 플랜 2·3 이어가기용(플랜 2 부분은 이제 완료). §5·§6 여전히 유효 |

## 1. 현재 상태 — 플랜 1·2 완료

- **플랜 1(캐리어 통합 계층)**: `apps/core/src/modules/fulfillment/waybill/carrier/`. HMAC 골든벡터 검증. DB 무관.
- **플랜 2(도메인 계층)**: SDD 14태스크 + 최종 하드닝 완료. 게이트 = waybill 단위 50 + 통합 20/20 PASS · `tsc -p apps/core/tsconfig.app.json --noEmit` exit0 · `nest build core` 성공. 최종 whole-branch 리뷰 opus **"Ready to merge(플랜3 토대로서): Yes"** (Critical 0).
  - `inventory.schema.ts`에 `waybills` + enum 2종 **additive**(invoices 무손). 마이그레이션 `20260717015642_add-waybills.sql`.
  - `waybill/` 전체 계층: repository(CAS)·issue-machine(drive)·reader·manager(8메서드)·service·dto·controller·module·carrier factory·smoke.
- **검증된 핵심 불변식**: durable pending 행 → carrier HTTP는 **tx 밖** → CAS 전이. `uq_waybills_tracking_live` 부분 UNIQUE + 한진 ERROR-09(기등록=성공)으로 타임아웃/재구동에도 **이중등록 차단**. recipientHash 는 발급/디스패치 시점 모두 `canonicalFulfillmentRequestHash(recipientSnapshot)`로 동일.

## 2. 플랜 3가 소비할 seam (WaybillService API) — 핸드오프 핵심

`WaybillModule` 이 `WaybillService` 를 export. 소비자는 이 메서드를 부른다. `Actor = {id: string; roles: string[]}`.

```ts
class WaybillService {
  // carrier 발급 — 외부 HTTP 포함, tx? 안 받음(호출자 tx 밖에서 불러야).
  issueForShipment(shipmentId, opts: {carrier: CarrierCode; expectedManifestVersion: number}, idemKey, actor): Promise<WaybillView>
  reissue(shipmentId, opts: {carrier; expectedManifestVersion}, idemKey, actor): Promise<WaybillView>   // void+발급
  issueBatch(shipmentIds: string[], opts: {carrier}, idemKey, actor): Promise<BatchResultItem[]>          // shipment별 현재 manifestVersion 사용

  // tx-local(외부호출 없음) — tx? 전파 가능.
  registerManual(shipmentId, {carrier, trackingNo, expectedManifestVersion, reason?}, idemKey, actor, tx?): Promise<WaybillView>  // source='manual' 즉시 registered
  void(waybillId, {reason}, idemKey, actor, tx?): Promise<WaybillView>          // registered→voided(발송전). used/shipped→WAYBILL_ALREADY_DISPATCHED
  assertDispatchable(shipmentId, tx?): Promise<WaybillRow>                       // 활성 1개 ∈{registered,used}+carrier+trackingNo+manifest/recipient 일치. 불일치→WAYBILL_STALE
  markUsed(shipmentId, tx?): Promise<void>                                        // registered/used→used. 멱등+엄격(0행→예외)
  getActiveWaybill(shipmentId, tx?): Promise<WaybillView | null>                  // 종료3상태 제외 활성행
}
```

**tx 규칙(중요)**: `issueForShipment`/`reissue`/`issueBatch`는 carrier HTTP를 수행하므로 **호출자 tx에 넣으면 안 된다**(tx? 파라미터 없음). 반면 `registerManual`/`void`/`assertDispatchable`/`markUsed`/`getActiveWaybill`는 tx-local이라 dispatch tx에 전파한다.

**seam 순서 계약(최종리뷰 Important — 필수)**: 디스패치는 **한 tx 안에서 `assertDispatchable(shipmentId, tx)` 직후 `markUsed(shipmentId, tx)`** 를 부른다. `markUsed`는 staleness(manifest/recipient)를 재검사하지 않으므로, assertDispatchable을 선행 게이트로 두지 않으면 stale 운송장을 used로 마킹할 수 있다.

**에러 코드**: 전부 `WAYBILL.ERROR.*`(`waybill.constants.ts`) 문자열이 `@app/shared` 예외 메시지에 임베드됨. 소비자/테스트는 메시지 정규식으로 단언.

## 3. 구 InvoiceOrchestrator → WaybillService 메서드 매핑

| 구(InvoiceOrchestrator) | 신(WaybillService) | 주의 |
|---|---|---|
| `issueForShipment`(provider, **async**·invoiceOperations 큐) | `issueForShipment`(**sync**·요청내 drive) | 비동기 오퍼레이션 폴링 로직 제거, 동기 결과. |
| `issueManualInvoice`(self) | `registerManual` | assertProfileComplete 미적용(계승 유지). |
| `void`/`voidManualInvoice` | `void`(통합) | 구 void는 invoiceId, 신 void는 **waybillId**. |
| `assertDispatchableInvoice` | `assertDispatchable` | externalServiceId 요구 폐지, self/provider 통일. |
| dispatch의 `invoices.status='used'` 직접갱신(`shipment-dispatch.service.ts:782-785`) | `markUsed(shipmentId, tx)` | assertDispatchable 직후 같은 tx. |
| `wmsTables.invoices` 직접쿼리 | `getActiveWaybill(shipmentId, tx)` | invariant/consolidation/planning. |

## 4. 플랜 3 범위 — 소비자 rewire (spec §12)

**주입 교체(InvoiceOrchestrator → WaybillService)** + 메서드명 매핑(§3):
- `services/shipment-dispatch.service.ts` — `assertDispatchableInvoice`→`assertDispatchable`; `invoices.status='used'`→`markUsed`; `dispatchLocked`의 staleness 재검(609-618, 구 `canonicalShipmentRecipientHash` 사용 — 삭제됨)는 `assertDispatchable`가 이미 검사하므로 그 반환행을 신뢰하거나 재검 로직 제거.
- `services/shipment-recall.service.ts`, `services/shipment-short-pick.service.ts` — `@Inject(forwardRef(()=>InvoiceOrchestrator))`→WaybillService. **주의**: 구 `void`는 recall operation으로 **used/발송된** 송장도 void 가능했으나, 신 `void`는 used/shipped를 `WAYBILL_ALREADY_DISPATCHED`로 거부. 발송된 shipment 회수(recall) 시나리오가 신 void 계약과 어떻게 맞물리는지 **착수 시 recall 플로우 실측 후 결정**(회수=재고 되돌림+운송장 상태 처리 분리 가능성).
- `services/outbound-batch-orchestrator.service.ts` — 배치 발급→`issueBatch`. **+ 부수 수정**: `isActiveWorkItemUniqueViolation`(약 1312행)이 top-level `.code`만 검사(drizzle0.44.7 잠재버그) → `waybill.manager.ts`의 `isUniqueViolation`(.cause 5-deep) 이식.
- `picking/{discrete-picking, aggregate-then-sort, pick-to-tote}.strategy.ts` — 선발급 `issueForShipment`. **주의**: 신 `issueForShipment`는 carrier HTTP 동기수행이라 **피킹 tx 밖에서** 호출해야 함(tx 안에서 부르면 HTTP-in-tx). 피킹 전략의 발급 지점을 tx 경계 밖으로 조정.
- `controllers/shipment-invoice.controller.ts` → **삭제**(신 `WaybillController`가 대체, 이미 구현됨). 라우트 경로가 달라졌으니(`/shipments/:id/waybills` 등) admin-web 등 클라이언트 영향 확인.
- `services/fulfillment-invariant.service.ts`, `consolidation.service.ts`, `shipment-planning.service.ts` — `wmsTables.invoices` 직접 read→`getActiveWaybill`.
- `fulfillment.module.ts` — InvoiceOrchestrator·GoodsflowDeliveryProvider·HanjinDeliveryProvider·InvoiceRecoveryWorker·ShipmentInvoiceController 제거 + WaybillModule import(§5 순환해소 후).

**모듈 순환 해소(§5)**: 현재 플랜 2에서 `WaybillModule` → `FulfillmentModule`(FulfillmentCommandService 획득). 플랜 3에서 dispatch가 WaybillService를 소비하면 `FulfillmentModule` → `WaybillModule` 이 필요 → **순환**. 해소: `FulfillmentCommandService`(+의존 DbService만)를 작은 `FulfillmentCommandModule`로 추출해 provides/exports, `FulfillmentModule`·`WaybillModule` 양쪽이 import. 그러면 `WaybillModule`은 FulfillmentModule을 더는 import 안 하고, `FulfillmentModule`이 `WaybillModule`을 import(spec §4 방향). (FulfillmentModule 은 무거워 테스트 모듈 파급 주의 — 추출은 재-export로 기존 소비자 무영향 유지.)

## 5. 삭제 목록 (contract phase)

- 코드: `invoice-orchestrator.service.ts`, `invoice-recovery.worker.ts`, `delivery-provider.interface.ts`, `goodsflow-delivery.provider.ts`(+spec), `hanjin-delivery.provider.ts`(+spec), `dto/shipment-invoice.dto.ts`, 구 `shipment-invoice.controller.ts`(+spec).
- 스키마: `invoices`·`invoiceOperations` 테이블, `invoiceStatusEnum`/`invoiceMethodEnum`/`invoiceOperationTypeEnum`/`invoiceOperationStatusEnum` enum, `invoicesRelations`/`invoiceOperationsRelations`. + `wmsTables`에서 `invoices`/`invoiceOperations` 등록 제거.
  - **마이그레이션 = destructive contract phase**: 실 데이터 없음(ADR-0005 예외지만 순서는 지킴). `db:generate:core -- --name drop-invoices`. **배포 순서 `sst deploy → db:migrate`**(옛 task가 destructive migration 만나면 사고). autodeploy 없으니 운영자 규율.
- env(`config/env.validation.ts`): **죽은 키만** 제거 — `HANJIN_API_URL`·`HANJIN_CUSTOMER_CODE`·`HANJIN_SENDER_CODE`·`HANJIN_PICKUP_SITE_CODE`·`HANJIN_SENDER_PHONE`(delivery-provider era) + 구 goodsflow 키. **주의: `HANJIN_API_KEY`·`HANJIN_TIMEOUT_MS`·`HANJIN_SENDER_NAME`는 신 `loadHanjinConfig`가 재사용하므로 유지.** 신 키(`HANJIN_CLIENT_ID/SECRET_KEY/CONTRACT_NO/ORDER_BASE_URL/PRINT_BASE_URL/SENDER_ZIP/SENDER_BASE_ADDR/SENDER_DTL_ADDR/SENDER_TEL/BOX_TYPE/PAY_TYPE`)는 유지.

## 6. 무회귀 계약

- **self 계승**(어제 develop 동작 중): dispatch-gate self 완화·void 발송전 안전범위·`assertProfileComplete` 미적용 → `registerManual`이 이미 담음(플랜 2 검증). 회귀 금지.
- **기존 outbound 통합 테스트**: 구 invoice path 테스트(`invoice-orchestrator.integration.spec.ts` 등)는 삭제/재작성. outbound **흐름** 테스트(dispatch/recall/short-pick end-to-end: `outbound-batch-orchestrator`·`outbound-v2-*`·`consolidation`·`fulfillment-invariant` integration spec)는 **invoice 대신 waybill 시드로 rewire**하고 green 유지. 참고: 구 `eligibleFixture`가 넣던 `invoices` 행(`canonicalShipmentRecipientHash` 사용)이 `waybills` 행으로 바뀜. 플랜 2의 `__support__/waybill-fixtures.ts`(`seedPlannedShipmentForWaybill`/`makeSeedDeps`) 재사용.

## 7. 배포 전 / 잔여

- **실 app-boot DI smoke**: 플랜 2에서 `.compile()` DI 테스트는 env 제약(FulfillmentModule→SalesOrderModule Kafka bootstrap + jest `@packages/event-contracts` mapper 갭)으로 skip, 정적 트레이스+`nest build`로 대체함. 플랜 3 배선(모듈 순환 해소) 후 **Kafka broker 있는 환경에서 실제 부팅**해 `WaybillService` DI 해결 + 무순환 확인.
- **스테이징 스모크**: `npx tsx scripts/smoke/hanjin-staging-smoke.ts` (dev key로 order 호스트 insert-order/tracking body 실검증). `print-wbl`(ebbapd)은 **방화벽 IP 화이트리스트** 확인 — 미커버면 그 body는 `smoke-pending`.
- **라이브 자격증명**: 개발 완료 후 한진 라이브 서비스 허가 별건(테스트 서버 dev key만 발급된 상태).

## 8. 이어가는 법

1. 브랜치 `feat/waybill-module-redesign` 체크아웃(`.superpowers/sdd/progress.md`로 플랜 1·2 완료 확인 — **재실행 금지**). tip=`e2cda3ce1`.
2. spec §12 재독 + §2 seam API 숙지 → **플랜 3를 writing-plans로 작성**(모듈 순환 해소·recall-void 시맨틱·마이그레이션 순서·테스트 rewire를 태스크로) → SDD로 실행.
3. 컷오버 후: 무회귀 outbound 통합 green → 실 app-boot DI smoke → develop 머지 → `db:setup`(add-waybills + drop-invoices 마이그레이션 적용) → 스테이징 스모크.

## 9. 교훈 (플랜 1·2, 그대로 적용)

- **검증에 full `tsc` 필수**(ts-jest transpile-only). spec 파일은 tsc 게이트 제외(`**/*spec.ts` exclude)라 spec 타입에러는 jest 런타임에서만 드러남.
- **리뷰어 제안도 로직 검증 후 적용.**
- **drizzle 0.44.7**: 제약명·SQLSTATE(23505)는 에러 `.cause` 체인에 있음(top-level 아님). 통합테스트 제약 단언·unique-violation 감지 모두 `.cause`-walk.
- **DB 통합**: `npm run test:core:integration:local -- <pattern>`. 단위: `npm run test -- --testPathPattern=<pattern>`. import 깊이: `waybill/` 직속 파일은 `../../inventory/...`·`../services/...`, `waybill/__support__/`는 한 단계 더.
- **lint 스코프**: 변경/신규 파일 신규 error만. 컨트롤러 spec의 jest-mock `unbound-method`는 repo 관례(레퍼런스 동일).
