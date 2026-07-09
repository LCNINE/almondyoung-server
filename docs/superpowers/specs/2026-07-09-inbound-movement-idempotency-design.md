# 입고/이동 요청 멱등화 설계 (P2-4)

> 출처: `docs/logistics-backend-hardening-2026-07.md` P2-4 — 입고/이동 경로 전부 `idempotencyKey` 미전달, 재전송 시 중복 입고(재고 2배).
> 승인: 2026-07-09 (브레인스토밍 세션).

## 1. 문제

`InventoryCommandService`(receive/adjustUp/adjustDown/moveInternal)와 `StockEventStore.createEvent`는 이미 `idempotencyKey?`를 받아 `onConflictDoNothing(stock_events.idempotency_key)` + 충돌 시 기존 이벤트 반환까지 구현돼 있으나, **입고/이동 호출자들이 키를 만들지도 넘기지도 않는다**. 재-POST(네트워크 타임아웃 재시도, 더블클릭) 시 중복 입고/이동이 그대로 원장에 반영된다.

추가로, 이벤트 레벨 키만 넣는 것은 불충분하다:

- receive 계열은 이벤트 앞뒤로 journal·receipt·line row를 INSERT — 이벤트만 dedup되면 **중복 receipt/journal이 생기고 라인이 남의 이벤트를 참조**하는 반쪽 상태가 된다.
- `putaway`/`returnInbound`는 누적 카운터(`putawayFromOriginQty`, `returnedQty`)를 갱신 — 이벤트만 dedup되면 **카운터가 원장 없이 이중 증가**한다.

따라서 본질은 **요청(핸들러) 단위 멱등화**이고, 이벤트 레벨 키는 심층 방어로 병행한다.

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 키 필수 여부 | **required** (DTO `@IsNotEmpty`) | 현재 소비자는 admin-web뿐(모노레포, 동시 배포). 미래 외부 클라이언트는 처음부터 계약을 따르는 것이 바람직 — optional이면 방어가 구멍난 채 잔존 |
| 키 전달 방식 | **DTO body 필드** `idempotencyKey` | class-validator 검증이 자연스럽고 헤더 플럼빙 불필요 |
| 중복 응답 | **저장된 응답 그대로 반환 (200)** | 클라이언트 재시도 로직 단순화 — 응답 유실돼도 재전송으로 결과 회수 |
| dedup 메커니즘 | **전용 idempotency 테이블 + 공용 헬퍼** | 9개 경로 전부 동일 패턴, aggregate row 없는 경로(putaway/return)도 커버, 동시 중복은 unique 행 락으로 직렬화 |

## 3. 적용 범위 (9개 핸들러)

| 엔드포인트 | 서비스 메서드 | endpoint 논리 이름 |
|---|---|---|
| `POST /inbound/simple` | `inbound.service.ts` `simpleInbound` | `inbound.simple` |
| `POST /inbound/simple-fullscan` | `simpleInboundFullscan` | `inbound.simple-fullscan` |
| `POST /inbound/individual` | `individualInbound` | `inbound.individual` |
| `POST /inbound/plans/receive` | `receiveFromPlan` | `inbound.plans.receive` |
| `POST /inbound/putaway` | `putaway` | `inbound.putaway` |
| `POST /inbound/return` | `returnInbound` | `inbound.return` |
| `POST /inbound/cancel` | `cancelInbound` | `inbound.cancel` |
| `POST /movement/move` | `movement.service.ts` `moveImmediately` | `movement.move` |
| `POST /movement/inter-warehouse` | `createInterWarehouseTransfer` | `movement.inter-warehouse` |

**제외**: `POST /movement/jobs/:jobId/complete` — 원장 미접촉(입고예정 갱신뿐), 자연 멱등.

**inter-warehouse 주의**: 이 경로는 P0-1 결함(출발지만 차감)으로 WS-B에서 `TransferService`로 재배선 예정. DTO 필드·래퍼는 컨트롤러/DTO 레벨이라 재배선 후에도 살아남으므로 지금 포함한다. 이 작업은 P0-1을 고치지 않는다.

## 4. 서버 설계

### 4.1 테이블 `inventory_idempotency_requests` (additive 마이그레이션 1개)

```
id            uuid PK (defaultRandom)
endpoint      varchar(64) NOT NULL     -- §3 논리 이름
key           varchar(128) NOT NULL
request_hash  varchar(64) NOT NULL     -- SHA-256(JSON.stringify(dto)) hex. 키 정렬 정규화는 하지 않음 —
                                       -- 같은 클라이언트의 재전송은 직렬화가 동일하고, 오탐은 409(안전한 방향)로만 귀결
response      jsonb                    -- null = 처리 중 (커밋 전에는 외부에서 관찰 불가)
created_at    timestamptz NOT NULL defaultNow
UNIQUE (endpoint, key)
INDEX (created_at)                     -- 보존 크론용
```

inventory 스키마(`inventory.schema.ts`)에 정의. `stock_events` 직접 INSERT가 아니므로 arch test(`inventory-write-boundary.arch.spec.ts`) 영향 없음.

### 4.2 공용 헬퍼 `InventoryIdempotencyService`

위치: `apps/core/src/modules/inventory/core/services/inventory-idempotency.service.ts`. ADR-0025 준수 — `dbService.run`, `tx?: DbTx` 전파, 단일 러너.

```typescript
async withIdempotency<T>(
  endpoint: string,
  key: string,
  requestBody: unknown,          // hash 산출용
  handler: (tx: DbTx) => Promise<T>,
  tx?: DbTx,
): Promise<T>
```

동작 (전 과정 단일 tx):

1. `INSERT ... ON CONFLICT (endpoint, key) DO NOTHING RETURNING id` — `request_hash` 포함.
2. **신규(RETURNING 있음)**: `handler(trx)` 실행 → 반환값을 같은 row의 `response`에 UPDATE → 반환. handler throw 시 키 row까지 롤백 → 재시도가 깨끗하게 재실행.
3. **충돌(RETURNING 없음)**: 기존 row 조회.
   - `request_hash` 불일치 → `ConflictError('idempotencyKey 재사용: 다른 요청 본문')` (409).
   - `response !== null` → 저장된 응답 반환 (재-POST 흡수).
   - `response === null` → `ConflictError('동일 요청 처리 중')`. (동시 중복은 unique INSERT의 행 락 대기로 직렬화되어 커밋 후 도달하므로 구조상 드묾 — 방어적 분기.)

에러는 `@app/shared` 도메인 예외(`ConflictError`)만 사용. 응답 타입 T는 jsonb 직렬화 가능해야 함(현 9개 경로 모두 plain object).

### 4.3 핸들러 배선

각 서비스 메서드 본문 전체를 래퍼로 감싼다:

```typescript
async simpleInbound(dto: SimpleInboundDto, tx?: DbTx) {
  return this.idempotency.withIdempotency('inbound.simple', dto.idempotencyKey, dto, async (trx) => {
    // 기존 본문 (dbService.run 내부 로직) — trx 사용
  }, tx);
}
```

### 4.4 이벤트 레벨 심층 방어 (파생 키)

래퍼와 별개로 각 원장 쓰기 호출에 파생 키 전달. **키는 `endpoint` 네임스페이스를 접두해 생성**한다 —
형식은 `` `${endpoint}:${dto.idempotencyKey}` `` (단건) / `` `${endpoint}:${dto.idempotencyKey}:${i}` `` (루프),
`endpoint`는 각 메서드가 `withIdempotency` 호출에 쓰는 것과 동일한 논리 이름(§3 표).

- 단건 경로: `` `inbound.individual:${dto.idempotencyKey}` ``, `` `inbound.plans.receive:${dto.idempotencyKey}` ``,
  `` `inbound.putaway:${dto.idempotencyKey}` ``, `` `inbound.return:${dto.idempotencyKey}` ``,
  `` `movement.inter-warehouse:${dto.idempotencyKey}` ``.
- 루프 경로: `` `inbound.simple:${dto.idempotencyKey}:${i}` ``, `` `inbound.simple-fullscan:${dto.idempotencyKey}:${i}` ``,
  `` `movement.move:${dto.idempotencyKey}:${i}` ``.
- `cancelInbound`의 `reverseEvent`는 원 이벤트 역분개로 자체 멱등 — 파생 키 제외.

**근거 (최종리뷰 2026-07-09)**: `stock_events.idempotency_key`는 전역 UNIQUE다. 네임스페이스 없이 `dto.idempotencyKey`를
그대로 쓰면, 클라이언트가 같은 키 문자열을 서로 다른 엔드포인트(예: `inbound.return`과 `movement.move`)에
재사용했을 때 두 번째 호출의 이벤트 INSERT가 `onConflictDoNothing`으로 조용히 스킵된다 — `withIdempotency`
래퍼는 (endpoint, key) 복합 unique라 신규 요청으로 통과하므로, 원장 이벤트 없이 receipt/counter만 갱신되는
half-state가 발생한다. endpoint 접두로 교차-엔드포인트 충돌을 원천 차단한다.

`stock_events.idempotency_key`는 varchar(128) 전역 unique. 최악 예산: `movement.inter-warehouse`(24자) +
`:`(1) + key(90, §5) + `:` + 인덱스(최대 3자리) = 119 < 128. DTO `@MaxLength(90)`로 여유 확보(§5).

## 5. DTO / admin-web

- 9개 요청 DTO에 `idempotencyKey: string` 추가 — `@IsString() @IsNotEmpty() @MaxLength(90)`, **required**.
  90 = §4.4 파생 키 길이 예산(`movement.inter-warehouse:` 접두 24자 + `:`+인덱스 최대 4자 여유를 varchar(128) 안에 확보).
- admin-web `lib/api/domains/inventory/inbound.client.ts` · `movement.client.ts`: 해당 mutation payload에 `idempotencyKey` 포함.
- **키 수명주기 (계획 수립 시 구체화)**: 대상 mutation 전부가 `lib/services/inventory/mutations.ts` 한 파일을 경유하므로, 키 관리를 central 래퍼 훅 `useIdempotentMutation`으로 통일한다 — 컴포넌트 call site 무수정.
  - 키는 훅의 `useRef`에 유지 → react-query 자동 재시도와 **네트워크 오류 후 사용자 재클릭이 같은 키를 재사용** (서버 replay = P2-4 핵심 시나리오 방어).
  - **성공 시** 키 교체(다음 제출은 새 작업), **4xx 거부 시** 교체(서버 미커밋 확정 — 사용자가 폼을 고쳐 재제출하면 새 요청).
  - **네트워크/타임아웃/5xx 시** 키 유지 — 서버가 커밋했을 수 있으므로 재클릭이 저장 응답을 replay해야 함.

## 6. 배포 / 운영

- 마이그레이션: additive 1개 (`npm run db:generate:core -- --name add-inventory-idempotency-requests`). expand-contract상 코드와 같은 PR 가능.
- **stale-tab**: required 전환이므로 배포 직후 새로고침 안 한 admin-web 탭은 400. 관리자 도구 특성상 수용 — 별도 2단계 전환 없음.
- 보존: 야간 크론(03:30 KST, `LedgerReconciliationService` 크론 옆 별도 소형 크론)에서 `created_at` 30일 초과 row 삭제.

## 7. 테스트

- **단위**: `withIdempotency` — 신규 실행/같은 키 재호출 시 handler 미실행+응답 동일/hash 불일치 409/handler throw 시 키 미잔존/`response=null` 충돌 시 409.
- **통합** (⏸ dev DB 복구 시 실행 — 작업 1·2와 동일 관례): 같은 키 2회 POST → stock_events 1건·카운터 1회 증가·응답 동일. 대표 경로: `inbound/simple`(루프+receipt), `inbound/return`(카운터), `movement/move`.
- **회귀**: 기존 arch test·tsc·lint GREEN 유지.

## 8. 비목표

- P0-1(inter-warehouse 소실) 수정 — WS-B.
- Wallet Idempotency-Key(P2-12)와의 관례 통일 — 별도 항목.
- 다른 BC(fulfillment 등)로의 idempotency 테이블 일반화 — 필요 시 후속.
