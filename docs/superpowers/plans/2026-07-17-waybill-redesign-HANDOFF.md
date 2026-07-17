# 운송장(waybill) 모듈 재설계 — 핸드오프 (플랜 2·3 이어가기)

- 작성: 2026-07-17
- 브랜치: `feat/waybill-module-redesign` (tip 커밋은 `git log` 확인; 작성 시점 플랜1 완료 상태)
- 목적: 플랜 1(캐리어 통합 계층) 완료 후, **플랜 2(도메인 계층)·플랜 3(컷오버)** 를 다른 세션에서 이어받기 위한 상태·계약·주의 요약.

## 0. 먼저 읽을 것 (참조 맵)

| 문서 | 내용 |
|------|------|
| `docs/superpowers/specs/2026-07-17-waybill-module-redesign-design.md` | **설계 원본**(SoT). 엔티티 §5, 캐리어 포트 §6, 한진 어댑터 §7, 상태머신 §8, 서비스/컨트롤러 §9, 배치 §10, void/재발급 §11, consumer 마이그레이션 §12, 테스트 §14, 리스크 §16 |
| `docs/superpowers/plans/2026-07-17-waybill-carrier-integration.md` | **플랜 1**(완료). 이 계층의 최종 코드 형태·TDD 태스크 |
| `.superpowers/sdd/progress.md` | 플랜 1 SDD 실행 원장(태스크별 리뷰·fix·회귀·교훈). git-ignored |
| (auto-memory) `waybill-module-redesign` | 세션 간 요약 |

## 1. 현재 상태 — 플랜 1 완료

**캐리어 통합 계층**이 `apps/core/src/modules/fulfillment/waybill/carrier/` 에 구현·리뷰 완료(최종 whole-branch 리뷰 opus "Ready to merge: Yes"). DB·상태 무관. 게이트: 19 유닛 PASS(config 2·signer 3·client 5·gateway 9) · `tsc -p apps/core/tsconfig.app.json --noEmit` exit 0 · eslint 0 error(6 = 테스트더블 `as any` 경고, 관례·비차단).

생성 파일:
- `carrier/carrier-gateway.interface.ts` — 추상 포트 + 타입
- `carrier/hanjin/hanjin.config.ts` — `loadHanjinConfig(env)` / `isHanjinConfigured`
- `carrier/hanjin/hanjin-hmac.signer.ts` — HMAC 서명(공식 골든 벡터 검증)
- `carrier/hanjin/hanjin-api.client.ts` — native fetch, 두 호스트, 제네릭 `post<T>`/`get<T>`, HTTP→`CarrierError`
- `carrier/hanjin/hanjin-carrier.gateway.ts` — allocate(print-wbl)·register(insert-order)·track(tracking-wbl)
- `apps/core/src/config/env.validation.ts` — `HANJIN_*` 13키(additive)

**브랜치는 미머지 유지** — 캐리어층만으론 소비자가 없어 develop 머지 시 dead code. 플랜 2·3 가 같은 브랜치에 얹혀 컷오버까지 끝나야 머지.

## 2. 플랜 2가 소비할 seam (계약) — 핸드오프 핵심

플랜 2의 `WaybillIssueMachine`/`WaybillManager` 는 아래 **이미 구현된** 포트를 소비한다. (`carrier-gateway.interface.ts`)

```ts
abstract class CarrierGateway {
  readonly carrier: CarrierCode;                 // 'HANJIN'
  readonly capabilities: { allocatesExternally; registersSeparately; canTrack; canCancel };
  isConfigured(): boolean;                        // = isHanjinConfigured(config) (env presence)
  allocate(req: WaybillRequest): Promise<AllocateResult>;              // { waybillNo, labelData }
  register(wbl: string, req: WaybillRequest): Promise<RegisterOutcome>;// {kind:'registered'|'already_registered'|'rejected', reason?}
  track?(wbl: string): Promise<CarrierScan[]>;
  cancel?(...)                                    // 한진 미구현(capabilities.canCancel=false)
}
WaybillRequest = {
  custOrdNo: string;                              // ≤30B, 우리 상관키 — 파생규칙 미정(§아래 4)
  recipient: { name; zip; baseAddress; detailAddress; tel?; mobile?; message? };
  sender:    { name; zip; baseAddress; detailAddress; tel? };   // 창고/config
  items: { name; code?; quantity }[];
  commodityName; boxType; payType;                // boxType/payType 소스 = req(게이트웨이는 config 기본값 안 씀)
}
```

**drive() 매핑** (§8): `pending → allocate() → allocated(waybillNo·labelData durable 저장) → register(waybillNo,req) → registered`. `RegisterOutcome.kind`: `registered`/`already_registered`(ERROR-09 멱등) → **registered**; `rejected` → **failed**. 게이트웨이가 던지는 `CarrierError`:
- `outcome:'definitive_rejection'` → 확정 실패(failed 로).
- `outcome:'unknown_outcome'`(타임아웃/5xx/408/429) → **부작용 미상** → 재구동(같은 wblNo 로 register 재시도, ERROR-09 가 등록 확인). **절대 삼키지 말 것.**

**중요**: `WaybillRequest` 는 shipment/manifest/recipient 스냅샷 + config(sender·box/pay·custOrdNo)에서 **플랜 2가 조립**한다. 이 조립부가 한진 와이어 계약이 실제로 맞물리는 지점 → §5 스모크 필요.

## 3. 플랜 2 (도메인 계층) — 작성/구현 범위

spec §5·§8·§9·§10·§11 구현. writing-plans 로 상세 TDD 플랜 작성 후 SDD 실행.

- **스키마**(`inventory.schema.ts`, additive — invoices 는 아직 안 건드림): `waybills` 테이블 + `waybillStatusEnum`(pending/allocated/registered/used/voided/failed/**abandoned**) + `waybillSourceEnum`(carrier/manual). 제약: `trackingNo` 부분 UNIQUE `WHERE trackingNo IS NOT NULL AND status NOT IN ('voided','failed','abandoned')`; 활성 UNIQUE `ON(shipmentId) WHERE status NOT IN ('voided','failed','abandoned')`. 마이그레이션 생성.
- **`WaybillIssueMachine.drive()`** — 상태전이(§8 전이표). **abandon 비대칭**(핵심): `pending` 포기=attempts CAP 자동(안전); `allocated` 포기=운영자 전용(이중등록 위험, 자동 금지, 미해결 wblNo 기록). CAP 는 pending 에만.
- **`WaybillService/Manager/Reader`** — seam(§9.1, 플랜 3 소비자가 부름): `issueForShipment`·`issueBatch`·`registerManual`(source='manual', 즉시 registered)·`void`·`reissue`·`assertDispatchable`·`markUsed`·`getActiveWaybill`. CLAUDE.md 정식 레이어 + `@app/shared` 예외.
- **DTO + `WaybillController`**(§9.2) — 라우트 6개, `idempotency-key` 필수(`FulfillmentCommandService.commands.execute` 재사용).
- **배치**(§10) — `issueBatch`: shipment별 waybill 행 durable 생성 → `print-wbls`(≤100) → 건별 register. **동기 실행 시간 리스크**: bounded 병렬 + 시간예산 조기반환 정책을 이 플랜에서 확정.

## 4. 플랜 2 착수 시 확정할 미정 사항 — ✅ 해소됨 (2026-07-17, spec §3.1)

4건 모두 브레인스토밍으로 확정, 설계 SoT는 **spec §3.1**. 요약:

- **custOrdNo 파생규칙** → `'AY'+Crockford-base32(shipmentId 16B)`=28자(≤30B). 결정적·shipment 1:1·분할배송 고유. (§3.1-1)
- **박스/지불조건·송하인 소스** → `HanjinConfig`(env) 단일 송하인. `loadHanjinConfig`가 이미 sender/boxType('A')/payType('PP') 로드 → 조립부가 소비만. per-shipment 오버라이드·다창고 송하인은 후속. (§3.1-2)
- **markUsed 통합** → `markUsed(shipmentId, tx?)` 캡슐화, dispatch tx 안에서 호출. 멱등(used→used no-op)+엄격(status∈{registered,used}, 활성 1행 아니면 도메인 예외). (§3.1-3)
- **스테이징 스모크** → dev key로 테스트 서버 접근 가능. order 호스트(insert-order/tracking) 실검증, `print-wbl`은 방화벽 IP 커버 착수 시 확인·미커버면 `smoke-pending` 게이트. 라이브 자격증명은 개발 완료 후 별건. (§3.1-4)

## 5. 플랜 3 (컷오버, contract) — 범위

플랜 2 완료 후. spec §12.

- **소비자 rewire**(InvoiceOrchestrator 주입 → WaybillService): `services/{shipment-dispatch, shipment-recall, shipment-short-pick, outbound-batch-orchestrator}.ts`, `picking/{discrete-picking, aggregate-then-sort, pick-to-tote}.strategy.ts`, `controllers/shipment-invoice.controller.ts`(→ WaybillController), `fulfillment.module.ts`. `wmsTables.invoices` 직접 read → `getActiveWaybill` (`fulfillment-invariant`·`consolidation`·`shipment-planning`).
- **삭제**: `invoice-orchestrator.service.ts`, `invoice-recovery.worker.ts`, `delivery-provider.interface.ts`, `goodsflow-delivery.provider*.ts`, `hanjin-delivery.provider*.ts`, `dto/shipment-invoice.dto.ts`, 구 `shipment-invoice.controller.ts`, `invoices`/`invoiceOperations` 테이블 + 구 invoice enum + 구 goodsflow/hanjin env.
- **계승 필수(회귀 금지)**: 어제 머지된 self 경로(dispatch-gate self 완화·void 발송전 안전범위·`assertProfileComplete` 미적용)를 `registerManual` 로. 기존 outbound 통합 테스트로 무회귀 고정.
- **seam 순서(최종리뷰 하드닝)**: dispatch must call assertDispatchable → markUsed in one tx (markUsed doesn't re-check staleness).

## 6. 교훈 / 주의 (플랜 2·3에 그대로 적용)

- **검증에 full `tsc` 필수.** ts-jest 는 transpile-only 라 타입 에러(예: fetch headers TS2769)를 못 잡는다. 각 태스크에 `npx tsc -p apps/core/tsconfig.app.json --noEmit` exit 0 게이트.
- **리뷰어 제안 한 줄도 로직 검증 후 적용.** 플랜 1 최종리뷰의 error-code 제안을 검증 없이 넣었다가 회귀(모든 거절이 no_wbl_num). "테스트를 버그에 맞춰 조정" = 회귀 신호.
- **골든 벡터 없는 필드는 실검증 전까지 미확정.** HMAC 만 골든 벡터로 확정; body 매핑은 스테이징 스모크로.
- **DB 통합 테스트**는 `npm run test:core:integration:local -- <pattern>`(러너가 compose postgres+migrate+jest --runInBand). 단위는 `npm run test -- --testPathPattern=<pattern>`.
- **lint 스코프**: 변경/신규 파일의 신규 **error** 만(전역 warning·기존 debt 제외). 커밋 전 `npx eslint --fix`.

## 7. 미해결 Minor(플랜 1, 최종리뷰 defer — 필요 시 하드닝)

- 테스트더블 `as any`/`as HanjinConfig`(6 warning, 관례). client `response.json()` 의 `no-unsafe-return` 1줄 disable(fetch 경계, Acceptable).
- 커버리지: config 파싱 엣지·signer 소문자 method·client 408/429 임계 미독립테스트. `occurredAt` statusDate 빈값 시 Invalid Date(플랜 2 영속 전 가드 권장). register `rejected` reason 빈 message 시 후행콜론(소비자 없음).

## 8. 이어가는 법

1. 브랜치 `feat/waybill-module-redesign` 체크아웃(플랜 1 커밋들 존재; `.superpowers/sdd/progress.md` 로 완료 태스크 확인 — **플랜 1 재실행 금지**).
2. spec 재독(§5·§8·§9~11) → **플랜 2를 writing-plans 로 작성**(§4 미정사항 먼저 확정) → SDD(subagent-driven-development)로 실행.
3. 플랜 2 완료·검증 후 **플랜 3 작성→실행**(컷오버). 컷오버 후 develop 머지 + `db:setup`(마이그레이션) + 스테이징 스모크.
