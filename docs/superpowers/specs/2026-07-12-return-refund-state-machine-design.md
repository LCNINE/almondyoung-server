# 작업 14 — 반품 환불 상태기계 설계 (WS-D, P1-8·P1-9 + P2-12 + P1-10)

> 물류 백엔드 정상화 스프린트 현황판(`docs/logistics-backend-hardening-2026-07.md`) §5 WS-D 작업 14.
> 권장 작업 분할(현황판 line 275)과 브레인스토밍(2026-07-12)으로 확정한 결과.

## 1. 배경

반품 환불 완료 흐름(`apps/core/src/modules/sales-order/services/store-return-exchange.service.ts`)이 세 결함으로 **환불 성공 후 `refund_pending` 영구 고착**을 만든다.

- **P1-8**: Wallet `already_refunded` outcome 을 완료로 매핑하지 않음(`:493`, `:748` 모두 `outcome.kind === 'success'` 만 완료). 취소 경로(`store-sales-orders.service.ts:747-761`)는 `already_refunded → succeeded` 매핑 — **불일치**.
- **P1-9**: Wallet 환불 호출(`:486-490`)과 완료 update(`:505-513`)가 **tx 밖**. Wallet 성공 후 완료 update 전 크래시 시 돈은 나갔는데 `refund_pending` 유지 → P1-8 때문에 재시도로도 탈출 불가.
- **P2-12**: 반품 재시도 correlationId 가 `return:{id}:refund:retry:{randomUUID()}`(`:730`). Wallet `Idempotency-Key` 헤더 = correlationId(`wallet-refund.client.ts:71`)이므로, **랜덤 key = Wallet 재생(replay) 불가 = 크래시 복구 불가**. 동시 재시도 이중환불 방어가 전적으로 Wallet refundable 검증에 위임.
- **P1-10**(동반): `calculateReturnRefund`(`:1287-1320`) 부분반품 비례식 — 분모 `allLinesTotals`(`:1308`)는 `totalPrice ?? unitPrice*qty`, 분자 `returnedLinesTotals`(`:1315`)는 `unitPrice*qty`. 라인 할인(`totalPrice ≠ unitPrice*qty`) 시 과대/과소 산정.

**핵심 통찰**: P1-8·P1-9·P2-12 는 별개 버그가 아니라 **하나의 메커니즘**이다 — Wallet 이 idempotency key 로 성공·실패를 모두 캐시하므로, 결정적 key 를 재사용하면 성공을 재생해 복구되고, 랜덤 key 를 쓰면 재생 불가 + `already_refunded` 미매핑으로 고착된다.

## 2. 착수 재확인으로 확정한 사실 (Wallet 멱등성 코드 직접 확인, 2026-07-12)

`apps/wallet/src/domain/idempotency/{http-idempotency.interceptor.ts, idempotency.service.ts}` 를 직접 열어 확인:

- **성공·실패 모두 캐시**: 인터셉터가 `completeSuccess`/`completeFailure` 로 응답을 저장. 실패(4xx·5xx)도 `FAILED` 로 저장돼 같은 key 재요청 시 **캐시된 실패를 REPLAY**(`idempotency.service.ts:218-235`). TTL 기본 24h(만료 시 재처리).
- **동시 같은 key = 409 IN_FLIGHT**: PENDING(처리중·미만료) 상태에서 같은 key 재요청은 `IDEMPOTENCY_KEY_IN_FLIGHT` 409 throw(`:204-207`). = **이중처리 없음**.
- **성공 REPLAY**: `SUCCESS` 캐시는 원 응답 재생(`:210-215`) → 크래시 후 같은 key 재호출 = 원 성공 재생.
- **body hash 검증**: 같은 key + 다른 body → `IDEMPOTENCY_KEY_HASH_MISMATCH` 409(`:184-189`). ⟹ **재시도 amount 가 초회와 동일해야** 재생 성립.
- **key = correlationId**: Core→Wallet 호출은 actor='anonymous', key 유일성은 correlationId 전부(`buildRecordId = sha256(actorId:key)`).

**client 현황**(`wallet-refund.client.ts`): non-ok 응답을 `already_refunded`(특정 코드) 외 전부 `kind:'failed'` 로 몰고 **HTTP status 를 버린다**(`:88-135`) → return 서비스만으로 확정(4xx 비즈니스 거부)/불확정(5xx·in-flight) 구분 불가. `already_refunded` 는 `REFUND_AMOUNT_EXCEEDS_AVAILABLE/TOTAL` 코드 = **환불가능 잔액 소진** 시에만 발생(`:115-118`) → 부분환불에서는 잔액이 남아 `already_refunded` 가 안 나옴.

**상태 enum**: `returnRequestStatusEnum`(`inventory.schema.ts:3235`)에 `refund_pending`·`completed` 존재. **신규 상태값 불요** — `refund_pending` 이 복구 앵커.

**동시성**: `findReturnRequestOrThrow`(`:980`)는 `.for('update')` 없음 → Phase 1 무잠금(동시 completeReturn/retry TOCTOU 가능).

## 3. 결정 (브레인스토밍, 2026-07-12)

### 3.1 결정적 key + intent-first attempt 행 (규율 1·2·3)

랜덤 key 를 **시도별 결정적 key** 로 통일하되, 사용자 지정 3규율을 상태기계 본체로 반영:

- **규율 1 — N 증가는 확정 실패에서만**: 새 key(N+1)는 Wallet 이 **명시적으로 미환불을 확정**한 경우만. 불확정(타임아웃·네트워크·5xx·자기 크래시)에서 N 을 올리면 이중환불(Wallet 이 이미 환불했는데 새 key 로 재환불 — 부분환불은 `already_refunded` 방어 안 됨). 불확정이면 **같은 key 재생**이 답(재생이 성공/실패의 진실을 알려줌).
- **규율 2 — intent-first SoT 행**: "이전 링크 수 +1 즉석 계산"은 링크 쓰기 유실 시 N 재사용 루프 위험. 대신 **Wallet 호출 전 attempt 행(key·amount·status=pending)을 먼저 커밋**하고 그 행을 key 의 단일 진실(SoT)로 삼는다. 어느 지점 크래시든 재시도가 같은 행을 읽어 같은 key 재생. 이 행이 곧 P1-9 가 요구하는 복구 가능 상태기계.
- **규율 3 — 409 IN_FLIGHT ≠ 확정 실패**: Wallet 처리중 크래시 시 pending 레코드가 TTL(24h)까지 409 를 반환. 확정 실패로 분류해 N 을 올리면 규율 1 위반. **불확정 버킷(같은 key 재시도)** 으로 분류, N 증가 트리거에서 제외.

`already_refunded → completed` 매핑은 **2차 방어**로 병행(P1-8 종결). 기존 random-key 주석(`:716-717`)·테스트(`spec:807-842`) 삭제.

### 3.2 attempt 저장 = 신규 테이블 `return_refund_attempts`

```
return_refund_attempts
  id                uuid PK
  returnRequestId   uuid FK → return_requests(id)   (not null, index)
  attemptNumber     int  not null                    (1-base)
  idempotencyKey    text not null                    (= correlationId, SoT)
  amount            int  not null                    (Wallet body SoT — 재생 시 동일 amount 강제)
  status            enum('pending','succeeded','failed') not null default 'pending'
  walletOutcome     jsonb                             (관측용: outcome.kind·errorCode)
  createdAt / updatedAt  timestamptz
  UNIQUE (returnRequestId, attemptNumber)             (동시성 belt — Phase A FOR UPDATE 와 이중화)
  UNIQUE (returnRequestId) WHERE status='pending'     (불변식: 반품당 in-flight attempt 최대 1개 — Phase A 의 "pending 재사용" 규칙을 DB 로 강제)
```

- key = `return:{returnRequestId}:refund:{attemptNumber}` (초회 N=1 포함 통일). amount·key 를 행에 **고정** → 재생 시 동일 body(규율 2, HASH_MISMATCH 회피).
- 대안(businessLinks 재사용 + pre-write/update)은 append-only 감사 시맨틱을 흐리고 (rrId,N) 유니크 제약이 없어 기각.
- **스키마 변경**: additive(신규 테이블·enum) = ADR-0005 §5 상 **단일 PR**(destructive 아님). 마이그레이션은 오프라인 `drizzle-kit generate`(작업 8a 판례), **적용은 dev DB 복구 시 ⏸**(작업 1·8a·2·3 미적용분과 일괄). 작업 4~13 의 "스키마 무변경" 연속은 규율 2 의 durable SoT 요구가 정당화하며 여기서 끊긴다.

### 3.3 실패 분류 = client 정제로 자동 판정 (선택지 A)

`wallet-refund.client.ts` 를 정제해 확정/불확정을 노출:

- **`failed` 에 `determinate: boolean` 추가** — 4xx 비즈니스 거부·200-OK 이나 refund status=FAILED → `determinate:true`(Wallet 미환불 확정). 5xx → `determinate:false`(불확정).
- **`in_flight` kind 신설** — 409 `IDEMPOTENCY_KEY_IN_FLIGHT` 전용(불확정, 규율 3). 기존엔 `failed` 로 몰렸다.
- 취소 경로(`store-sales-orders.service.ts`)의 `switch(outcome.kind)`: `failed` case 는 유지(필드 추가는 비파괴). `in_flight` 는 새 case 추가로 명시 처리 — **net 동작 보존**(기존 409→`failed`→failed 기록 → 이제 409→`in_flight`→취소 경로에선 manual_pending/재시도 안내로, 무손실·개선). 취소 경로의 **행동 변경은 in_flight 매핑 1건뿐**이며 이중환불 위험 없음.
- 기각 대안 (B) 보수적 무자동증가: 확정 실패도 operator 명시 액션으로만 N+1 → 안전하나 확정 실패 복구가 수동, UX 부담. client 무변경 이점보다 자동화 손실이 큼.

### 3.4 통합 상태기계 (P1-9 본체)

초회(`completeReturnRequest` Phase 2)와 재시도(`retryReturnRefund`)의 중복 Wallet 로직을 **단일 헬퍼 `attemptReturnRefund(returnRequestId, adminId)`** 로 통합. 3-phase:

- **Phase A (tx, `return_request` FOR UPDATE)** — 동시성 직렬화 + attempt 행 확보:
  - RR 이 `completed` → no-op(현재 상태 반환)
  - `pending` attempt 행 존재 → **재사용**(복구/in-flight, 규율 2 SoT) — 같은 key·amount
  - pending 없고 (최초 or 직전 attempt `failed`) → **새 행 INSERT**(N=max+1, pending, 새 key, 재계산 amount) — 규율 1
  - **커밋** = Wallet 호출 전 durable (intent-first, 규율 2)
- **Phase B (tx 밖)** — 행의 key·amount 로 `walletRefundClient.refundByIntent`
- **Phase C (tx, FOR UPDATE)** — 결과 분류로 attempt 행 + RR 전이 + businessLink 감사 기록:

| Wallet outcome | 확정성 | attempt 행 | RR 상태 | 다음 재시도 |
|---|---|---|---|---|
| `success` | 확정 성공 | → succeeded | → completed | (종결) |
| `already_refunded` | 확정 성공(2차 방어) | → succeeded | → completed | (종결) |
| `partial_pending` | 진행중(불확정) | pending 유지 | refund_pending | 같은 key 재생 → 수동확인 |
| `failed` determinate=true | 확정 실패 | → failed | refund_pending | **N+1 새 key** |
| `failed` determinate=false(5xx) | 불확정 | pending 유지 | refund_pending | 같은 key 재생(TTL/운영) |
| `in_flight`(409) | 불확정(규율3) | pending 유지 | refund_pending | 같은 key 재생 |
| `wallet_unavailable` | 불확정 | pending 유지 | refund_pending | 같은 key 재생 |

복구: 모든 재시도가 `attemptReturnRefund` 재진입 → Phase A 가 pending 행을 찾아 같은 key 재생 → Phase C 가 진실로 해소. 크래시 지점 무관(성공-후-행미기록 → 같은 N 재생 성공 / 성공-후-행기록-전-완료미전이 → pending 행 있으니 재생 성공 or already_refunded → completed).

### 3.5 P1-10 계산 통일

`calculateReturnRefund` 분자를 분모와 동일 기준으로: 라인별 무게 = `totalPrice ?? unitPrice*qty`, 반품 비중 = `(반품수량/라인수량) × 라인무게` 합. 할인 라인도 정확 비례. 격리된 순수함수 수정(부수효과 0).

## 4. 스코프 — 변경 사항

1. **신규 `inventory.schema.ts`**: `returnRefundAttemptStatusEnum` + `returnRefundAttempts` 테이블 + `returnExchangeTables` 그룹 export 추가. 오프라인 마이그레이션 생성.
2. **`wallet-refund.client.ts`**: `failed.determinate` 필드 + `in_flight` kind + non-ok status 기반 분류(§3.3).
3. **`store-return-exchange.service.ts`**:
   - `attemptReturnRefund` private 헬퍼 신설(3-phase 상태기계, §3.4).
   - `completeReturnRequest` Phase 2 를 `attemptReturnRefund` 호출로 대체(Phase 1 = inspected→refund_pending/completed 유지).
   - `retryReturnRefund` 를 `attemptReturnRefund` 호출로 대체(refund_pending 가드 유지, 링크-카운트 로직·randomUUID 제거).
   - `findReturnRequestOrThrow` 에 `.for('update')` 옵션(Phase A 직렬화).
   - `calculateReturnRefund` 분자 기준 통일(P1-10).
   - `already_refunded → completed` 매핑(2차 방어).
4. **`store-sales-orders.service.ts`**: `in_flight` case 추가(net 동작 보존, §3.3).
5. **`store-return-exchange.service.spec.ts`**: 상태기계 회귀 가드(§7). random-key 테스트 삭제.
6. **admin-web 무변경** — 재시도 엔드포인트 시그니처 불변(내부 동작만 변경).

## 5. 불가침 / 회귀 가드

- **이중환불 금지가 최상위 불변식** — 규율 1·2·3 의 어떤 위반도 회귀. attempt 행 = key·amount SoT, N 증가는 확정 실패만, 불확정은 같은 key 재생.
- **취소 경로 net 동작 보존** — client 정제가 취소 switch 를 깨지 않음(§3.3). `already_refunded → succeeded`(취소)·`success` 경로 무변경.
- **body hash 안정성** — 재생 시 amount 는 attempt 행에서 로드(재계산 금지) → HASH_MISMATCH 회피.
- **멱등 감사 연속성** — businessLink `return_linked_wallet_refund` 기록은 감사용으로 존치(상태 SoT 는 attempt 행). 타 리더 의존 확인.
- **immediateComplete(refund<=0)·no-walletIntentId(수동)** 경로 무변경.

## 6. 경계 / 비목표 (out of scope)

- **취소 경로 P2-12(결정적 key)** — 반품 경로만(현황판 범위 결정). 취소는 `already_refunded` 매핑 + succeeded 조기반환으로 잔여 위험 좁음. **명시적 후속으로 현황판 기록**. (본 작업은 취소 경로에 `in_flight` case 만 추가.)
- **P2-13**(부분취소 추정치 기환불 미차감) — advisory only, 최저 순위(현황판 ⬜ 유지).
- **Wallet 5xx-after-commit 잔여 위험** — Wallet 이 환불 커밋 후 500 을 던져 실패로 캐시하는 경우, 부분환불에서 Core 가 완전 방어 불가(Wallet 원자성 이슈). determinate=false 로 같은 key 재생·TTL·운영개입으로 완화, 근본 해소는 Wallet 소유.
- **자동 재시도 크론** — 반품 재시도는 operator 트리거 유지(무 hammering). 규율 3 의 "backoff>TTL" 은 수동 페이스라 운영 관측 사항으로 표현(반복 in_flight/5xx → `manualCompleteReturn`).

## 7. 검증 / 테스트

- **유닛 (dev DB 무의존)** — `store-return-exchange.service.spec.ts` 에 상태기계 회귀:
  - 크래시 복구: pending attempt 존재 → 재시도가 **같은 key** 로 재호출(replay) → success → completed.
  - 규율 1: `failed` determinate=true → attempt failed → 다음 재시도 **N+1 새 key**. determinate=false(5xx)/`in_flight`/`wallet_unavailable` → **같은 key** 유지.
  - P1-8: `already_refunded` → completed.
  - P1-10: 할인 라인 부분반품 비례 정확(분자·분모 동일 기준).
  - client 분류: 4xx→determinate true, 5xx→false, 409 IN_FLIGHT→`in_flight`.
  - 취소 경로 회귀: `in_flight` case net 동작.
  - 삭제: random-UUID 유일성 테스트(`spec:807-842`).
- **통합 (dev DB 복구 시 ⏸)** — attempt 행 intent-first 커밋·FOR UPDATE 직렬화·마이그레이션 적용. `isolatedModules` 라 별도 `tsc`(isolatedModules off)로 deferred spec 타입체크(작업 10 판례).
- **공통 규약 체크리스트**: `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS(신규 테이블은 store 미경유 write 아님) · 변경 파일 신규 eslint 0 · admin-web `type-check` 무영향.

## 8. 리스크

- **스키마 변경 재도입** — 스프린트 첫 신규 테이블(작업 4~13 무변경 연속 단절). additive 라 단일 PR·저위험이나 마이그레이션 적용 ⏸ 부채 1건 추가(기존 ⏸ 목록과 일괄 적용).
- **client 정제의 취소 경로 파급** — 공유 client 시그니처 변경이 취소 switch 에 닿음. `determinate` 필드는 비파괴(기존 `failed` case 무영향), `in_flight` 만 새 case → 취소 net 동작 보존을 유닛으로 봉인.
- **attempt 행 ↔ businessLink 이중 기록** — 상태 SoT(attempt 행)와 감사 로그(businessLink) 병존. 혼선 방지 위해 상태 판정은 **attempt 행만** 신뢰, businessLink 는 감사 전용 명문화. retry 의 기존 링크-카운트 의존 제거.
- **partial_pending 무한 pending** — 비동기 환불(무통장)은 attempt 가 pending 유지 → 재생해도 pending 반복. `manualCompleteReturn`(`:774`)이 종결 escape hatch(기존). 자동 async 확인 웹훅은 비목표.
