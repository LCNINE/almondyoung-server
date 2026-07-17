# Waybill (운송장) 모듈

`shipments` 에 대한 운송장(택배 송장) 발급·조회·취소·재발급을 담당한다. 굿스플로(구 invoice 레이어)를
대체하는 재설계 결과물이며, 현재 유일한 캐리어 연동은 한진(HANJIN)이다. 새 캐리어를 추가하려면
`carrier/carrier-gateway.interface.ts` 의 `CarrierGateway` 를 구현하고 `carrier-gateway.registry.ts` 에
등록한다.

## 레이어

```
Controller → Service → Manager → Reader / Repository
                          │
                          ├─ WaybillIssueMachine  (pending → allocated → registered 상태 전이 담당)
                          │        │
                          │        └─ CarrierGatewayRegistry → HanjinCarrierGateway → HanjinApiClient
                          │                                         (HanjinHmacSigner 로 서명)
                          └─ FulfillmentCommandService  (idempotency-key 기반 커맨드 실행, 플랜 2 방향:
                                                          WaybillModule → FulfillmentModule)
```

- **`waybill.controller.ts`** — HTTP 라우트 6개(§9.2), `ScopeGuard`/`RequireScopes`, `idempotency-key` 헤더 전달.
  try/catch 없음 — 도메인 예외는 `GlobalExceptionFilter` 가 상태코드로 변환.
- **`waybill.service.ts`** (`WaybillService`, Port) — 얇은 위임 계층. `WaybillRow` → `WaybillView` 변환(`toView`)만
  수행하고 검증 로직은 갖지 않는다.
- **`waybill.manager.ts`** (`WaybillManager`) — 모든 검증·비즈니스 로직·상태 전이 트리거. `issueForShipment`,
  `registerManual`, `void`, `reissue`, `assertDispatchable`, `markUsed`, `getActiveWaybill`, `issueBatch`
  seam(§9.1) 을 구현한다. carrier I/O 를 포함하는 메서드(`issueForShipment`/`issueBatch`/`reissue`)는 `tx?` 를
  받지 않는다 — 외부 HTTP 호출을 호출자 트랜잭션에 묶을 수 없기 때문. `registerManual`/`void`/`assertDispatchable`/
  `markUsed`/`getActiveWaybill` 는 외부 I/O 가 없어 `tx?: DbTx` 를 받아 호출자 트랜잭션에 합류할 수 있다.
- **`waybill.reader.ts`** / **`waybill.repository.ts`** — DB 조회/쓰기. `db.query.*`/`with`/`any` 캐스팅 금지,
  `select().from().where()` 명시적 쿼리만 사용(Inventory Query Rules).
- **`waybill-issue.machine.ts`** (`WaybillIssueMachine`) — 아래 상태머신 참고.
- **`carrier/hanjin/*`** — 한진 어댑터. `hanjin.config.ts`(env 로더+`isHanjinConfigured`) →
  `hanjin-hmac.signer.ts`(HMAC-SHA256 서명) → `hanjin-api.client.ts`(fetch 래퍼, order/print 호스트 분기) →
  `hanjin-carrier.gateway.ts`(`CarrierGateway` 구현: `allocate`=print-wbl, `register`=insert-order,
  `track`=tracking-wbl).

## 상태머신 (`WaybillIssueMachine`)

```
pending ──allocate(print-wbl)──▶ allocated ──register(insert-order)──▶ registered ──markUsed──▶ used
   │                                  │                                     │
   │ unknown_outcome × 5 시도         │ unknown_outcome(무제한, 자동포기 금지)│ void(발송 전만)
   ▼                                  ▼                                     ▼
abandoned                    (drive 재호출로 계속 재시도)                 voided
   │
   │ definitive_rejection(즉시)
   ▼
failed
```

- `drive(waybillId, req, tx?)` 는 저장된 행을 최종 상태(`registered`/`failed`/`abandoned`/정지된 `pending`)까지
  진행시킨다. 캐리어 HTTP 호출은 트랜잭션 밖에서, 각 상태 전이는 짧은 CAS 트랜잭션(`casToAllocated`/
  `casToRegistered`/`casToFailed`/`casToAbandoned`)으로 이루어진다 — 재구동해도 안전(멱등).
- **`pending` 단계 CAP**: `unknown_outcome`(타임아웃/5xx 등 결과 불명) 이 `WAYBILL.PENDING_ATTEMPTS_CAP`(5회) 를
  넘기면 자동으로 `abandoned` 처리한다.
- **`allocated` 단계는 CAP 없음**: 이미 캐리어에 채번된 `wblNo` 를 가진 상태이므로 자동 포기하지 않는다 —
  같은 `wblNo` 로 재구동하면 한진 `ERROR-09`(이미 등록됨) 가 멱등 성공으로 처리된다(§8). 이 비대칭(pending
  은 자동 abandon, allocated 는 금지)은 의도된 설계다.
- `definitive_rejection` 은 즉시 `failed` — 재시도하지 않는다.
- 운영자 전용 수동 abandon(교착 상태의 `allocated` 강제 해제) 엔드포인트는 이번 플랜 범위 밖이다(§11 은
  operator-only 로 명시했으나 본 플랜은 `drive` 재구동만 제공).

## Seam (플랜 3 소비자 진입점, §9.1)

`WaybillService` 가 노출하는 다음 메서드는 이번 플랜에서 **구현만** 되었고, 아직 어떤 소비자(dispatch/
picking/recall/short-pick/planning/invariant/consolidation)도 호출하지 않는다:

- `assertDispatchable(shipmentId, tx?)` — 발송 가능 여부 검증(`registered`/`used` + carrier/trackingNo +
  manifestVersion/recipientHash 일치). 불일치 시 `WAYBILL_NOT_DISPATCHABLE`/`WAYBILL_STALE`.
- `markUsed(shipmentId, tx?)` — `registered`/`used` → `used`. `used`→`used` 재호출도 멱등 성공(카운트 1개
  매칭), 매칭 0행이면 엄격하게 예외.
- `getActiveWaybill(shipmentId, tx?)` — 활성(비종료) 운송장 1건 조회.
- `issueBatch(shipmentIds, opts, idemKey, actor)` — bounded 병렬(§10, `WAYBILL.BATCH_CONCURRENCY`=8) +
  시간예산(`WAYBILL.BATCH_TIME_BUDGET_MS`=45s) 조기반환. 입력 shipmentId 전부가 출력에 나타난다(silent
  truncation 금지) — 시간 초과로 미착수된 건은 `status:'pending', reason:'time-budget-exceeded'`.

이들은 `tx?: DbTx` 를 받으므로(배치/발급 계열 제외) 호출자가 자기 트랜잭션 안에서 합류시킬 수 있다.

## 스테이징 스모크 실행법

```bash
npx tsx scripts/smoke/hanjin-staging-smoke.ts
```

CI 아님 — 사람이 dev key 를 손에 쥐고 직접 실행하는 스크립트다(`scripts/smoke/hanjin-staging-smoke.ts`).

- **env 미설정** (`HANJIN_CLIENT_ID`/`HANJIN_API_KEY`/`HANJIN_SECRET_KEY`/`HANJIN_CONTRACT_NO`/
  `HANJIN_ORDER_BASE_URL`/`HANJIN_PRINT_BASE_URL` 중 하나라도 없음 = `isHanjinConfigured` false): `SKIP:
  HANJIN_* env not configured` 를 출력하고 `exit 2`. 이것이 기본/기대 동작이다 — 대부분의 개발 환경엔 이
  키가 없다.
- **env 설정됨**: `loadHanjinConfig` → `HanjinHmacSigner` → `HanjinApiClient` → `HanjinCarrierGateway` 를
  조립하고 `assembleWaybillRequest` 로 샘플 `WaybillRequest` 를 만든 뒤,
  1. `allocate`(print-wbl) 시도 — 방화벽에 발신 IP 가 등록되어 있지 않으면 실패한다. 이 실패는 **크래시가
     아니라 경고 로그**로 처리된다(§3.1-4, silent 금지).
  2. `waybillNo` 를 받았으면 `register`(insert-order) + `track`(tracking-wbl) 을 순서대로 실사격 — order
     호스트는 dev key 로 접근 가능하므로 여기까지가 이 스크립트의 실질적 검증 범위다.
  3. `waybillNo` 를 못 받았으면(print-wbl 미가용) register/track 을 스킵하고 경고만 남긴다.
- (선택) sender 정보(`HANJIN_SENDER_NAME`/`HANJIN_SENDER_ZIP`/`HANJIN_SENDER_BASE_ADDR`/
  `HANJIN_SENDER_DTL_ADDR`/`HANJIN_SENDER_TEL`)와 `HANJIN_BOX_TYPE`/`HANJIN_PAY_TYPE` 도 채워야 실제 한진이
  거절하지 않을 만한 요청 바디가 만들어진다 — 비어 있어도 `isHanjinConfigured` 게이트 자체는 통과한다.

## 미해결 리스크 (UNRESOLVED RISKS)

1. **print-wbl 방화벽 IP whitelist (§3.1-4)** — `allocate`(print-wbl, print 호스트)는 발신 IP 가 한진 측
   방화벽에 등록되어 있어야 성공한다. 이 작업(IP 등록 요청·확인)은 아직 착수되지 않았다. 미커버 상태에서는
   스모크가 `allocate FAILED` 경고를 내고 `register`/`track` 을 스킵한다 — order 호스트(insert-order/
   tracking-wbl) 바디 매핑만 별도로 검증하려면 이미 알고 있는 `waybillNo` 를 스크립트에 임시로 하드코딩해
   손으로 우회해야 한다.
2. **라이브 자격증명은 개발 완료 후 별건** — 이 플랜에서 다루는 `HANJIN_*` 은 dev/staging key 다. 운영
   트래픽에 쓸 라이브 자격증명 발급·전환은 명시적으로 범위 밖이며 개발 완료 후 후속 작업이다.
3. **플랜 3 소비자 rewire 미완** — 위 Seam 섹션의 메서드들은 구현되어 있지만 dispatch/picking/recall/
   short-pick/planning/invariant/consolidation 등 어떤 소비자 모듈도 아직 이들을 호출하지 않는다. 구 invoice
   DROP, `FulfillmentCommandService` 추출을 통한 모듈 방향 반전도 플랜 3 범위다.
4. **Task 12 의 live-DI-in-sandbox residual** — `WaybillModule` 의 런타임 DI(`Test.createTestingModule({
   imports: [WaybillModule] }).compile()` 후 `moduleRef.get(WaybillService)`)는 이 개발 샌드박스에서 끝까지
   검증되지 않았다. 원인은 두 가지 모두 `WaybillModule` 자체와 무관한 선행 이슈: (a) `FulfillmentModule` →
   `SalesOrderModule` 이 `@packages/event-contracts` 를 bare specifier 로 import 하는데 루트 jest
   `moduleNameMapper` 는 subpath 폼(`^@packages/event-contracts/(.*)$`)만 매핑해 bare import 가 Jest 아래서
   해석되지 않는다. (b) 그 매핑을 임시로 고쳐도 `SalesOrderModule` 의 `EventsModule.forConsumerModule(...)`
   정적 Kafka 부트스트랩이 `KAFKA_BROKERS` 없이는 크래시하고, 더미 브로커를 주면 연결을 무한 재시도하며
   행(hang)한다. 대신 `nest build core` 전체 그래프 컴파일 성공 + 수동 의존성 감사(Task 12 리포트 참고)로
   간접 검증했다. `WaybillModule` 배선 자체를 의심할 근거는 없지만, 실제 `moduleRef.get()` 해석을 목격한 적은
   없다는 점을 정직하게 남겨둔다.
