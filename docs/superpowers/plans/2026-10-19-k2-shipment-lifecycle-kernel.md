# K2 상자 수명주기 커널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상자 상태를 바꾸는 쓰기는 전이 함수 하나(`transitionShipments`)를, 상자 구성을 바꾸는 쓰기는 문 하나(`editShipmentManifest`)를 지나게 하고, 우회를 가드 spec 으로 막는다.

**Architecture:** 커널은 Nest provider 가 아니라 **함수 모듈**이다(K1 과 같다). 새 폴더 `apps/core/src/modules/fulfillment/shipment/` 에 순수 전이표, 전이·생성 함수, 구성 편집의 문을 둔다. 호출 서비스의 생성자는 바뀌지 않는다 — 이미 주입받는 `invariant`·`reservations` 를 deps 로 넘긴다. 잠금·로드(`services/shipment-aggregate.ts`)는 제자리에 두고 여러 상자판만 더한다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest, isolatedModules), 실제 DB 통합 spec 은 rollback 트랜잭션(`inRollbackTx`).

**Spec:** `docs/superpowers/specs/2026-10-19-k2-shipment-lifecycle-design.md` (이하 «설계»). 실행자는 이 계획과 설계를 둘 다 읽는다.

## Global Constraints

- **`commandType`·`workflowGate` 이름·`canonicalRequest`·멱등 키·에러 `code`·에러 `message` 를 한 글자도 바꾸지 않는다.** 같은 검사인데 호출자마다 코드가 다른 곳(`SHIPMENT_NOT_DRAFT`·`BOX_NOT_DRAFT`·`SHIPMENT_REOPEN_REQUIRED`, `SHIPMENT_COMPONENT_CHANGED_RETRY`·`CONSOLIDATION_COMPONENT_CHANGED_RETRY`)도 각자 그대로다.
- **검사 순서를 바꾸지 않는다.** 위반이 여럿일 때 나오는 에러가 지금과 같아야 한다. 호출자의 사전 검사(버전·상태·복구 코드·합배송 여부)는 문에 들어가기 **전에** 지금 순서대로 둔다. 문이 하는 일(재잠금 → 상태 내부 단언 → `assertShipmentHasNoCustodyOrActiveWork` → `assertShipmentHasNoActiveWaybill`)은 지금 호출자가 그 두 가드를 부르던 자리에 온다.
- **동작 변경은 설계 §9 의 D1·D2 둘뿐이다.** D1: 재개봉 때 줄 버전은 검수 흔적(`inspected_qty > 0 OR forced`)을 지운 줄만 오른다. D2: 재개봉(`→ draft`)은 언제나 `manifestVersion` 을 올린다. 특성 테스트의 기대값은 이 둘을 일으키는 Task 에서만, 그 행만 바꾼다.
- **버전은 SQL 증가식으로 쓴다**(`sql\`${t.manifestVersion} + 1\``, `lineVersion` 도). 메모리의 옛 값 + 1 을 쓰면 같은 트랜잭션의 앞선 증가가 지워진다 — D2 의 +2 가 조용히 +1 이 된다.
- 마이그레이션 없음. API 응답 모양 불변.
- CLAUDE.md 규칙 그대로: `DbTx` 는 `inventory.schema` 에서 import, `any`·`as` 캐스팅 금지, 공개 함수의 tx 는 마지막 인자.
- **클래스 필드 초기화식에서 생성자 parameter property 를 읽지 말 것**(`useDefineForClassFields`). deps 는 메서드 안에서 만든다.
- 게이트: `npm run type-check` 0, `npx jest` 실패 0. 메모리 부족으로 죽으면 `npx jest --maxWorkers=2`.
- **통합 spec 은 임시 DB 에서 돌린다.** 로컬 공유 `core` DB 는 마이그 이력이 깨져 `test:core:integration:local` 이 migrate 에서 죽는다. 워크트리에서 그 러너를 돌리면 postgres 컨테이너가 재생성된다. 처음 한 번:
  ```bash
  docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE k2_it"
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k2_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  ```
  실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k2_it npx jest --runInBand --runTestsByPath <파일…>`. 아래에서 이 줄을 `IT <파일…>` 로 줄여 쓴다.
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_017iWMz8e9sogk1k9sXdYvAz`.
- 한 PR, squash-merge. 브랜치는 develop(`9f5e4f4ab` 이후)에서 `feat/k2-shipment-lifecycle`.

## Review Focus

- **배포를 걸친 멱등 재시도:** 같은 `idempotencyKey` 로 다시 보낸 분할·취소는 저장된 응답을 돌려줘야 하고 송장을 두 번 무효화하면 안 된다. → `shipment-planning.integration.spec.ts` 의 `splits 10 into 6/4 … replays`·`replays an immediate planned cancellation without voiding twice` 가 Task 5·7 뒤에도 초록이어야 한다(각 Task 의 실행 목록에 넣었다).
- **동시 합배송:** 서로 다른 키의 동시 합배송은 대상 하나만 만들어야 한다. 잠금 교체(Task 8)가 이걸 깨기 쉽다. → `consolidation.integration.spec.ts` 의 `serializes different-key concurrent consolidation` 을 Task 8 실행 목록에 넣었다.
- **택배사 이벤트 순서 뒤바뀜:** `delivered` 뒤에 늦게 온 `in_transit` 은 던지지 않고 무시돼야 한다(추적 기록은 남는다). → Task 1 이 기록하고 Task 4 가 지킨다.
- **대기 취소 재개 뒤 버전:** 재개봉(+1)과 줄 줄이기(+1)가 같은 트랜잭션에서 겹친다. 응답 `manifestVersion` 이 DB 값과 같아야 하고 줄 버전이 낡은 메모리 값으로 덮이면 안 된다. → Task 1 이 기록하고 Task 5 에서 D2 로 바꾼 뒤 Task 7 이 지킨다.
- **채널 수령인 정정의 가드 순서:** 활성 송장이 있는 `planned` 상자에 채널 정정이 오면 지금과 같은 코드로 거절돼야 한다. → Task 1 이 지금 코드를 기록하고 Task 8 이 지킨다.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `apps/core/src/modules/fulfillment/shipment/shipment-transitions.ts` (신규) | 순수: 상태·복구 코드 타입, 전이표, 합법성 판정, 목표 상태별 패치 | 2 |
| `.../shipment/shipment-transitions.spec.ts` (신규) | 전이표 단위 spec | 2 |
| `.../shipment/shipment-lifecycle.ts` (신규) | `transitionShipments`, `openShipment`, 공용 insert | 3 |
| `.../shipment/shipment-lifecycle.integration.spec.ts` (신규) | CAS·리셋·0행 정책 실제 DB spec | 3 |
| `.../shipment/shipment-manifest-edit.ts` (신규) | 문 `editShipmentManifest`, `ManifestWriter` | 6 |
| `.../shipment/shipment-manifest-edit.integration.spec.ts` (신규) | 문의 끝맺음·쓰기 범위 spec | 6 |
| `.../shipment/shipment-writes.guard.spec.ts` (신규) | 우회 금지 가드 | 9 |
| `.../services/shipment-aggregate.ts` | `lockShipmentAggregates` 추가, `lockShipmentAggregate` 는 그 위의 한 상자판 | 6 |
| `.../services/shipment-reservation.service.ts` | `bumpReservationVersions` 공개, `retargetConfirmed` 추가 | 7·8 |
| `.../services/{shipment-recall,short-pick-exit,shipment-delivery-tracking,shipment-dispatch}.service.ts` | 상태 쓰기 → 전이 함수 | 4 |
| `.../services/shipment-planning.service.ts` | 전이(Task 5), 분할·취소·정정(Task 7·8) | 5·7·8 |
| `.../services/consolidation.service.ts` | 보류 전이(Task 5), 활성화·잠금·예약(Task 8) | 5·8 |
| `.../services/draft-line-shrink.ts`, `.../draft-box/draft-box-amender.ts` | 문의 쓰기 도구 사용 | 7 |
| `.../services/fulfillments.service.ts` | 상자 생성 → `openShipment` | 8 |
| `docs/adr/0046-shipment-state-and-manifest-share-one-kernel.md` (신규), `docs/order-logistics-architecture-audit-2026-10.md` §8.1 | 결정 기록, 원본 교정 | 10 |

---

### Task 1: 특성 테스트 — 지금 동작을 기록한다

**Files (모두 기존 spec 에 `it` 을 더한다. 그 파일의 기존 셋업·픽스처를 재사용한다):**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-recall.integration.spec.ts`
- Modify: `.../services/short-pick-exit.integration.spec.ts`
- Modify: `.../services/shipment-planning.integration.spec.ts`
- Modify: `.../services/batch-cancel-withdraw.integration.spec.ts`
- Modify: `.../services/consolidation.integration.spec.ts`
- Modify: `.../services/shipment-delivery-tracking.integration.spec.ts`
- Modify: `.../services/shipment-recipient-from-channel.integration.spec.ts`

**Interfaces:** 없음. 버전은 절대값이 아니라 **명령 전후의 차이**로 단언한다(픽스처마다 시작 값이 다르다). 테스트 이름은 `K2 특성:` 으로 시작한다 — 뒤 Task 가 이 이름으로 찾는다.

- [ ] **Step 1: 테스트를 쓴다.** 각 단언은 명령 직전에 상자·줄 행을 읽어 두고 직후에 다시 읽어 비교한다.

  | 파일 · 옆에 둘 기존 테스트 | 이름 | 단언 |
  |---|---|---|
  | recall · `recalls a dispatched shipment synchronously…`(:397) | `K2 특성: 회수 완료는 상자와 줄의 검수·출고 흔적을 지운다` | `status='draft'`, `recoveryCode`·`plannedAt`·`shippedAt`·`deliveredAt` null, `manifestVersion` Δ=+1, 모든 줄 `inspectedQty=0`·`forced=false`·`lineVersion` Δ=+1 |
  | short-pick-exit · `집은 게 없으면 그 트랜잭션에서 나가며…`(:124) | `K2 특성: 결품 이탈은 manifest +1, 줄 버전 +1, 검수는 이미 0` | 이탈 **직전** 모든 줄 `inspectedQty=0`; 직후 `manifestVersion` Δ=+1, 모든 줄 `lineVersion` Δ=+1 |
  | planning · `cancels a planned shipment outside any batch immediately…`(:533) | `K2 특성: 배치 밖 planned 전량 취소는 manifest +1` | `status='canceled'`, `manifestVersion` Δ=+1 |
  | planning · `partial cancel of a planned shipment returns it to draft`(:557) | `K2 특성: planned 일부 취소는 manifest +1, 안 건드린 줄 버전 그대로` | `status='draft'`, `manifestVersion` Δ=+1, 취소하지 않은 줄 `lineVersion` Δ=0 (줄이 하나뿐인 픽스처면 줄을 둘로 만든다) |
  | batch-cancel-withdraw · `집은 게 없으면 그 트랜잭션에서 끝난다…`(:104) | `K2 특성: 이탈로 끝나는 전량 취소는 manifest +1` | `status='canceled'`, `manifestVersion` Δ=+1 (planned 시점 대비) |
  | batch-cancel-withdraw · `부분 취소 대기(E11) 뒤 운영자가…`(:201) | `K2 특성: 대기 취소 재개는 manifest +1` | 재개 응답 `manifestVersion` = DB 값, Δ=+1 (대기 진입 시점 대비) |
  | consolidation · 새 테스트(셋업은 `supersedes two FO shipments…`(:109) 를 본뜨고 원본 하나를 `plan` 으로 planned 로 만든다) | `K2 특성: 막힘 없는 planned 원본은 대기 없이 superseded 가 된다` | 오퍼레이션 `completed`, 그 원본 `status='superseded'`·`plannedAt` not null·`recoveryCode` null·`manifestVersion` Δ=+1, 대상 `status='draft'`·`manifestVersion=1` |
  | tracking · 새 테스트 | `K2 특성: delivered 뒤 늦게 온 in_transit 은 던지지 않고 무시한다` | 두 번째 이벤트가 resolve, 상자 `status='delivered'` 그대로, 그 이벤트의 `shipment_tracking` 행은 생김 |
  | recipient-from-channel · 새 테스트 | `K2 특성: 활성 송장이 있는 planned 상자의 채널 정정은 거절된다` | 지금 던지는 `code` 를 실행해서 확인하고 그 값을 그대로 단언(예상: `assertShipmentHasNoActiveWaybill` 의 코드). 상자 행 불변 |

- [ ] **Step 2: 지금 코드에서 모두 초록인지 확인한다.**
  Run: `IT` 위 7개 파일
  Expected: 전부 PASS. 하나라도 빨가면 설계의 사실이 틀린 것이다 — 멈추고 보고한다.

- [ ] **Step 3: 커밋** `test(fulfillment): K2 특성 테스트 — 재개봉·취소·합배송·추적의 지금 동작 기록`

---

### Task 2: 순수 전이표

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-transitions.ts`
- Test: `apps/core/src/modules/fulfillment/shipment/shipment-transitions.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ShipmentStatus = (typeof shipmentStatusEnum.enumValues)[number];
  export const RECOVERY_CODES = ['CANCEL_REPLAN_PENDING', 'CONSOLIDATION_PENDING', 'DISPATCH_RECALL_PENDING'] as const;
  export type RecoveryCode = (typeof RECOVERY_CODES)[number];
  export interface TransitionRule {
    from: ShipmentStatus; to: ShipmentStatus;
    fromCodes?: readonly RecoveryCode[];  // from 이 recovery_required 일 때 허용 코드
    toCodes?: readonly RecoveryCode[];    // to 가 recovery_required 일 때 허용 코드
  }
  export const SHIPMENT_TRANSITIONS: readonly TransitionRule[];
  /** 표에 없으면 Error(프로그래밍 오류). */
  export function assertLegalTransition(
    from: ShipmentStatus, to: ShipmentStatus,
    codes: { fromCode?: RecoveryCode; toCode?: RecoveryCode },
  ): void;
  export interface TransitionEffect {
    stamp: 'plannedAt' | 'shippedAt' | 'deliveredAt' | 'supersededAt' | null; // at 으로 채울 칼럼
    clears: ReadonlyArray<'recoveryCode' | 'plannedAt' | 'shippedAt' | 'deliveredAt'>;
    bumpsManifest: boolean;
    resetsInspection: boolean;   // 줄의 inspected_qty>0 OR forced 를 지우고 그 줄만 lineVersion+1 (D1)
  }
  export function transitionEffect(to: ShipmentStatus): TransitionEffect;
  ```
- 표(설계 §5.1, 14행): `draft→planned`; `draft→recovery_required`·`planned→recovery_required` toCodes `[CANCEL_REPLAN_PENDING, CONSOLIDATION_PENDING]`; `shipped→recovery_required` toCodes `[DISPATCH_RECALL_PENDING]`; `planned→draft`; `recovery_required→draft` fromCodes `[CANCEL_REPLAN_PENDING, DISPATCH_RECALL_PENDING]`; `draft→canceled`; `draft→superseded`·`planned→superseded`; `recovery_required→superseded` fromCodes `[CONSOLIDATION_PENDING]`; `planned→shipped`; `shipped→in_transit`; `shipped→delivered`; `in_transit→delivered`.
- 효과: `draft` → clears 넷 전부, bumpsManifest, resetsInspection(D1·D2) · `planned` → stamp plannedAt · `recovery_required` → 없음 · `shipped` → stamp shippedAt · `in_transit` → 없음 · `delivered` → stamp deliveredAt · `canceled` → bumpsManifest · `superseded` → stamp supersededAt, clears recoveryCode, bumpsManifest.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  ```ts
  it.each(SHIPMENT_TRANSITIONS.map((r) => [r.from, r.to]))('%s → %s 는 합법', (from, to) => { /* 허용 코드 하나를 골라 넘김, throw 안 함 */ });
  it('표에 없는 쌍은 Error', () => {
    expect(() => assertLegalTransition('delivered', 'draft', {})).toThrow(Error);
    expect(() => assertLegalTransition('draft', 'draft', {})).toThrow(Error);
    expect(() => assertLegalTransition('failed', 'draft', {})).toThrow(Error);
  });
  it('recovery_required 로 갈 때 코드가 없거나 허용 밖이면 Error', () => {
    expect(() => assertLegalTransition('draft', 'recovery_required', {})).toThrow();
    expect(() => assertLegalTransition('draft', 'recovery_required', { toCode: 'DISPATCH_RECALL_PENDING' })).toThrow();
  });
  it('CONSOLIDATION_PENDING 에서 draft 로는 못 간다', () => {
    expect(() => assertLegalTransition('recovery_required', 'draft', { fromCode: 'CONSOLIDATION_PENDING' })).toThrow();
  });
  it('재개봉 효과는 넷을 비우고 버전을 올리고 검수를 지운다', () => {
    expect(transitionEffect('draft')).toEqual({ stamp: null, clears: ['recoveryCode', 'plannedAt', 'shippedAt', 'deliveredAt'], bumpsManifest: true, resetsInspection: true });
  });
  it('superseded·canceled 도 manifest 를 올린다', () => {
    expect(transitionEffect('superseded').bumpsManifest).toBe(true);
    expect(transitionEffect('canceled').bumpsManifest).toBe(true);
  });
  ```
- [ ] **Step 2:** `npx jest apps/core/src/modules/fulfillment/shipment/shipment-transitions.spec.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현.** 표는 배열 리터럴 하나. `failed`·`canceled`·`superseded`·`delivered` 에서 나가는 행은 없다.
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5: 커밋** `feat(fulfillment): K2 상자 전이표 — 14개 전이와 목표 상태별 효과`

---

### Task 3: 전이 함수와 상자 생성

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-lifecycle.ts`
- Test: `apps/core/src/modules/fulfillment/shipment/shipment-lifecycle.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `assertLegalTransition`, `transitionEffect`, `ShipmentStatus`, `RecoveryCode`. `ShipmentRow` 는 `services/shipment-aggregate.ts`.
- Produces:
  ```ts
  export type ShipmentLineRecord = typeof wmsTables.shipmentLines.$inferSelect;
  /** 0행일 때: 'unreachable' = 내부 Error, 'ignore' = [] 반환, 함수 = 그 에러를 던진다(호출자 코드 보존). */
  export type StaleRowPolicy = 'unreachable' | 'ignore' | (() => Error);
  export interface ShipmentTransition {
    shipmentIds: readonly string[];
    from: readonly ShipmentStatus[];
    to: ShipmentStatus;
    recoveryCode?: RecoveryCode;          // to === 'recovery_required' 이면 필수, 아니면 금지
    expect?: { recoveryCode?: RecoveryCode; manifestVersion?: number }; // from 에 recovery_required 가 있으면 recoveryCode 필수
    shippingProfileId?: string;           // to === 'planned' 이면 필수, 아니면 금지
    at?: Date;                            // stamp·lastUpdated. 기본 new Date()
    stale: StaleRowPolicy;
  }
  export async function transitionShipments(tx: DbTx, t: ShipmentTransition): Promise<ShipmentRow[]>;
  export interface NewShipment {
    warehouseId: string; status: 'draft' | 'canceled';
    shippingProfileId: string | null; recipientSnapshot: unknown; entrancePassword: string | null;
    openedBy?: string | null; openedAt?: Date;
  }
  export interface NewShipmentLine {
    fulfillmentOrderItemId: string; skuId: string; qty: number;
    createdFromLineId?: string | null; demandRequestedAt?: Date | null; createdAt?: Date;
  }
  /** 새 상자와 줄을 한 번에. manifestVersion·reservationVersion 은 1. 예약은 부르는 쪽 몫. */
  export async function openShipment(tx: DbTx, box: NewShipment, lines: readonly NewShipmentLine[]):
    Promise<{ shipment: ShipmentRow; lines: ShipmentLineRecord[] }>;
  /** Task 6 의 쓰기 도구가 쓴다. 바깥에서 부르지 않는다(가드가 파일 단위로 허용). */
  export async function insertShipment(tx: DbTx, box: NewShipment): Promise<ShipmentRow>;
  export async function insertShipmentLine(tx: DbTx, shipmentId: string, line: NewShipmentLine): Promise<ShipmentLineRecord>;
  ```
- SQL 모양: `UPDATE shipments SET … WHERE id IN (…) AND status IN (from…) [AND (status <> 'recovery_required' OR recovery_code = expect.recoveryCode)] [AND manifest_version = expect.manifestVersion] RETURNING *`. 돌아온 행 수 < `shipmentIds.length` 이면 stale 정책. `to='planned'` 의 manifest 는 `manifest_version + CASE WHEN shipping_profile_id IS DISTINCT FROM $profile THEN 1 ELSE 0 END`(설계 §6.3). `resetsInspection` 이면 같은 함수 안에서 `UPDATE shipment_lines SET inspected_qty=0, forced=false, line_version=line_version+1 WHERE shipment_id IN (돌아온 id) AND (inspected_qty > 0 OR forced)`.
- 합법성 검사는 SQL 전에, `from` 의 각 원소 × `to` 로 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `inRollbackTx`(`services/__support__`)와 draft 상자를 만드는 기존 픽스처(`seedPickableShipment` 등)를 쓴다. planned·검수 흔적은 테스트 안에서 직접 UPDATE 로 만든다.
  ```ts
  it('표에 없는 전이는 SQL 전에 Error', …);                                  // delivered→draft, 행 불변
  it('planned→draft 는 넷을 비우고 manifest +1, 검수 흔적 있는 줄만 버전 +1', …); // 줄 A inspected 1·줄 B inspected 0 → A Δ+1·inspected 0, B Δ0
  it('forced 만 켜진 줄도 지우고 버전 +1', …);
  it('draft→planned 은 프로필이 같으면 manifest 그대로, 다르면 +1, plannedAt 을 찍는다', …);
  it('0행: unreachable 은 Error, ignore 는 [], 함수는 그 에러', …);       // from 을 일부러 틀리게
  it('expect.manifestVersion 이 다르면 0행', …);
  it('여러 상자: 하나라도 안 맞으면 stale', …);
  it('recovery_required 출발은 expect.recoveryCode 와 행의 코드가 같아야 한다', …);
  it('openShipment 은 draft 상자와 줄을 버전 1 로 만든다', …);
  ```
- [ ] **Step 2:** `IT apps/core/src/modules/fulfillment/shipment/shipment-lifecycle.integration.spec.ts` → FAIL
- [ ] **Step 3: 구현.**
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5: 커밋** `feat(fulfillment): K2 전이 함수 transitionShipments 와 openShipment`

---

### Task 4: 회수·결품 이탈·추적·출고를 전이 함수로 (D1)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-recall.service.ts:250-256, 431-453`
- Modify: `.../services/short-pick-exit.service.ts:79-106`
- Modify: `.../services/shipment-delivery-tracking.service.ts:210-222`
- Modify: `.../services/shipment-dispatch.service.ts:835-838`
- Modify: `.../services/short-pick-exit.integration.spec.ts`(Task 1 의 테스트 한 줄)
- Modify (필요할 때만): `.../services/shipment-delivery-tracking.service.spec.ts` 의 mock tx 가 `.returning()` 을 지원하도록

**Interfaces:**
- Consumes: Task 3 의 `transitionShipments`.

| 자리 | 호출 |
|---|---|
| 회수 검역 | `from:['shipped'], to:'recovery_required', recoveryCode:'DISPATCH_RECALL_PENDING', at: now, stale: () => this.conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed')` |
| 회수 완료 | `from:['recovery_required'], to:'draft', expect:{ recoveryCode:'DISPATCH_RECALL_PENDING', manifestVersion: shipment.manifestVersion }, at: recalledAt, stale: () => this.conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed during recall')`. `:434` 의 줄 UPDATE 를 지운다(전이 함수가 한다). `updatedShipment` 는 반환 배열의 [0] |
| 결품 이탈 | `from:['planned'], to:'draft', expect:{ manifestVersion: shipment.manifestVersion }, stale: () => conflict('SHIPMENT_STALE_MANIFEST_VERSION', \`Shipment ${intent.shipmentId} changed before short-pick exit\`)`. 상자 행이 없을 때도 같은 에러(지금처럼). `:103-106` 의 줄 UPDATE 를 지운다 |
| 추적 | `in_transit`: `from:['shipped'], to:'in_transit', at: occurredAt, stale:'ignore'`; `delivered`: `from:['shipped','in_transit'], to:'delivered', at: occurredAt, stale:'ignore'` |
| 출고 | `from:['planned'], to:'shipped', at: dispatchedAt, stale:'unreachable'` |

- [ ] **Step 1: D1 기대값을 바꾼다.** short-pick-exit 의 `K2 특성: 결품 이탈은 …` 에서 줄 `lineVersion` Δ 를 +1 → **0** 으로, 이름을 `K2 특성(D1): 결품 이탈은 manifest +1, 줄 버전 그대로` 로.
- [ ] **Step 2:** `IT .../short-pick-exit.integration.spec.ts` → 그 테스트만 FAIL
- [ ] **Step 3: 네 서비스를 위 표대로 바꾼다.**
- [ ] **Step 4: 실행**
  Run: `IT` recall·short-pick-exit·delivery-tracking·shipment-dispatch·carrier-tracking.poller·batch-session-recovery.short-pick 의 `.integration.spec.ts` 6개, 그리고 `npx jest apps/core/src/modules/fulfillment/services`
  Expected: 전부 PASS
- [ ] **Step 5: 커밋** `refactor(fulfillment): 회수·결품 이탈·추적·출고 상태 쓰기를 전이 함수로 (K2, D1)`

---

### Task 5: 계획·취소·합배송 보류를 전이 함수로 (D2)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts:541-552, 686-689, 1198-1201, 1357-1362, 1408-1415`
- Modify: `.../services/consolidation.service.ts:514-517`
- Modify: Task 1 의 planning·batch-cancel-withdraw 특성 테스트 4개(기대값 한 줄씩)

**Interfaces:**
- Consumes: Task 3 의 `transitionShipments`.

| 자리 | 호출 |
|---|---|
| 계획 `:541` | `from:['draft'], to:'planned', shippingProfileId: dto.shippingProfileId, stale:'unreachable'` (manifest 는 프로필이 바뀔 때만 — 함수가 정한다) |
| 취소 대기 `:686` | `from:[aggregate.shipment.status], to:'recovery_required', recoveryCode:'CANCEL_REPLAN_PENDING', stale:'unreachable'` |
| `applyPendingCancellation` `:1198` | `from:[aggregate.shipment.status]`(recovery_required 면 `expect.recoveryCode:'CANCEL_REPLAN_PENDING'`, planned 면 없음), `to:'draft', stale:'unreachable'` |
| `revert_planned` `:1357` | `from:['planned'], to:'draft', stale:'unreachable'` |
| `applyDraftCancellation` `:1408` | 전량: `from:['draft'], to:'canceled', stale:'unreachable'`. 일부: 상태는 그대로 두고 `manifestVersion: sql\`… + 1\``, `lastUpdated` 만 쓴다(Task 7 에서 문으로 옮긴다) |
| 합배송 보류 `consolidation:514` | `shipmentIds: sourceIds, from: 원본들의 상태 집합, to:'recovery_required', recoveryCode:'CONSOLIDATION_PENDING', at: now, stale:'unreachable'` |

- **D2 가 여기서 생긴다:** `planned`·대기 상자의 취소는 재개봉(+1)과 줄 줄이기 또는 `→ canceled`(+1)가 겹쳐 +2 가 된다. 그래서 `applyDraftCancellation` 의 버전 쓰기도 이 Task 에서 SQL 증가식이어야 한다 — 옛 `aggregate.shipment.manifestVersion + 1` 은 재개 경로에서 재개봉 전 값을 들고 있어 +2 를 +1 로 덮는다.

- [ ] **Step 1: D2 기대값을 바꾼다.** Task 1 의 planning `:533`·`:557`, batch-cancel-withdraw `:104`·`:201` 특성 테스트의 `manifestVersion` Δ 를 +1 → **+2** 로, 이름에 `(D2)` 를 붙인다. `:557` 의 «안 건드린 줄 버전 Δ0» 은 그대로다.
- [ ] **Step 2:** `IT` planning·batch-cancel-withdraw → 그 4개만 FAIL
- [ ] **Step 3: 위 표대로 바꾼다.**
- [ ] **Step 4: 실행**
  Run: `IT` shipment-planning·batch-cancel-withdraw·batch-withdraw·consolidation·outbound-v2-lifecycle-scenarios·outbound-v2-recovery-scenarios·withdrawn-forward-commands 의 `.integration.spec.ts`, 그리고 `npx jest apps/core/src/modules/fulfillment apps/core/src/modules/sales-order`
  Expected: 전부 PASS. 다른 테스트가 manifest 절대값 때문에 빨개지면, D2 로 설명되는 것만 기대값을 고치고 커밋 메시지에 파일을 적는다. 설명되지 않으면 멈추고 보고한다.
- [ ] **Step 5: 커밋** `refactor(fulfillment): 계획·취소·합배송 보류 상태 쓰기를 전이 함수로 (K2, D2)`

---

### Task 6: 구성 편집의 문

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-manifest-edit.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-aggregate.ts:58-73`
- Test: `apps/core/src/modules/fulfillment/shipment/shipment-manifest-edit.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 `insertShipment`, `insertShipmentLine`, `NewShipment`, `NewShipmentLine`, `ShipmentLineRecord`.
- Produces:
  ```ts
  // shipment-aggregate.ts
  /** 여러 상자판. 줄 서명은 `${shipment.id}:${line.id}:${line.fulfillmentOrderItemId}:${line.shipmentId}` 정렬. id 는 정렬·중복 제거. */
  export async function lockShipmentAggregates(
    tx: DbTx, invariant: FulfillmentInvariantService, shipmentIds: readonly string[], onChanged: () => Error,
  ): Promise<ShipmentAggregate[]>;
  // lockShipmentAggregate 는 이것의 한 상자판으로 바꾼다. onChanged = conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', 'Shipment component changed while acquiring locks')

  // shipment-manifest-edit.ts
  export interface ManifestEditDeps {
    invariant: FulfillmentInvariantService;
    reservations: Pick<ShipmentReservationService, 'recompute'>;
  }
  export type EditableStatus = 'draft' | 'planned' | 'recovery_required';
  export interface ManifestEdit {
    shipmentIds: readonly string[];      // 이 문에서 구성이 바뀔 수 있는 기존 상자
    allow: readonly EditableStatus[];    // 어기면 내부 Error — 호출자가 먼저 자기 코드로 검사한다
  }
  export interface ManifestWriter {
    createShipment(box: NewShipment): Promise<ShipmentRow>;
    addLine(shipmentId: string, line: NewShipmentLine): Promise<ShipmentLineRecord>;
    moveLine(lineId: string, fromShipmentId: string, toShipmentId: string): Promise<void>;
    setLineQty(lineId: string, shipmentId: string, qty: number): Promise<void>;
    reviseRecipient(shipmentId: string, recipientSnapshot: unknown): Promise<void>;
    setEntrancePassword(shipmentId: string, entrancePassword: string): Promise<void>;
    setShippingProfile(shipmentId: string, shippingProfileId: string | null): Promise<void>;
  }
  export async function editShipmentManifest<T>(
    deps: ManifestEditDeps, edit: ManifestEdit,
    body: (writer: ManifestWriter, aggregates: ShipmentAggregate[]) => Promise<T>,
    tx: DbTx,
  ): Promise<T>;
  ```
- 문의 순서: `lockShipmentAggregates(…, onChanged: 내부 Error)` → 각 상자 상태가 `allow` 안인지 단언(아니면 `Error`) → 각 상자 `assertShipmentHasNoCustodyOrActiveWork` → `assertShipmentHasNoActiveWaybill` → `body` → 끝맺음.
- 쓰기 도구 규칙: `edit.shipmentIds` 또는 이 문에서 만든 상자만 대상이다(아니면 `Error`). `moveLine`·`setLineQty` 는 `lineVersion` 을 SQL 증가식으로 올리고 `WHERE id = lineId AND shipment_id = from` 이 1행이 아니면 `Error`. 기록: `moveLine` → from·to 둘 다 «줄 바뀜», `setLineQty`·`addLine` → «줄 바뀜», `reviseRecipient`·`setShippingProfile` → «송장 내용 바뀜», `setEntrancePassword` → 아무것도 기록하지 않음.
- 끝맺음: (1) **기존 상자** 중 «줄 바뀜» 또는 «송장 내용 바뀜» 인 것마다 `manifest_version + 1`, `last_updated` 한 번. 이 문에서 만든 상자는 올리지 않는다(1 그대로). (2) «줄 바뀜» 인 상자(기존·새 상자 모두)마다 `reservations.recompute`. 순서는 `edit.shipmentIds` 순서, 그다음 만든 순서.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  ```ts
  it('줄 수량을 바꾸면 그 상자 manifest +1 한 번, 줄 버전 +1, 예약 재계산', …); // setLineQty 두 번 해도 manifest Δ+1
  it('줄을 새 상자로 옮기면 원본 +1, 새 상자 1, 둘 다 재계산', …);
  it('비밀번호만 바꾸면 manifest 그대로, 재계산 없음', …);
  it('수령인을 바꾸면 manifest +1, 재계산 없음', …);
  it('allow 밖 상태면 body 전에 Error', …);
  it('활성 송장이 있으면 assertShipmentHasNoActiveWaybill 의 에러, body 안 돎', …);
  it('edit 밖 상자에 쓰면 Error', …);
  ```
  서명 비교는 `shipment-aggregate.ts` 에 순수 함수 `aggregateSignature(aggregates: ShipmentAggregate[]): string` 으로 빼서 export 하고, 같은 파일 옆 `shipment-aggregate.spec.ts`(신규)에서 단위로 단언한다: 줄이 다른 상자로 옮겨지면 서명이 달라지고, 상자·줄 순서가 달라도 같다.
  재계산 호출은 `reservations` 에 실제 서비스를 감싼 `jest.fn` 으로 센다.
- [ ] **Step 2:** `IT .../shipment/shipment-manifest-edit.integration.spec.ts` → FAIL
- [ ] **Step 3: 구현.** `lockShipmentAggregate` 를 새 함수 위로 옮긴다(시그니처·에러 코드 불변).
- [ ] **Step 4:** 같은 명령 + `IT .../services/fulfillment-invariant.integration.spec.ts .../draft-box/draft-box-amender.integration.spec.ts` → PASS
- [ ] **Step 5: 커밋** `feat(fulfillment): K2 구성 편집의 문 editShipmentManifest 와 여러 상자 잠금`

---

### Task 7: 분할·취소 줄이기·구성 수정을 문으로

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts`(`split`·`splitUnreserved`·`applySplit` `:177-336, 1457-1567`, `applyDraftCancellation` `:1367-1438`)
- Modify: `.../services/draft-line-shrink.ts`
- Modify: `.../draft-box/draft-box-amender.ts`
- Modify: `.../services/shipment-reservation.service.ts:1271`(`bumpReservationVersions` 를 `private` → 공개)

**Interfaces:**
- Consumes: Task 6 의 `editShipmentManifest`, `ManifestWriter`.
- Produces:
  ```ts
  // draft-line-shrink.ts — writer 를 받는다. 예약 해제는 지금처럼 먼저.
  export async function shrinkDraftLines(
    reservations: ShipmentReservationService, writer: ManifestWriter,
    input: { shipment: ShipmentRow; lines: ReadonlyArray<{ line: ShipmentLineRow; qty: number }>; reason: string; actorId: string; wholeShipment: boolean },
    tx: DbTx,
  ): Promise<{ tombstone: ShipmentRow | null }>;
  // ShipmentReservationService
  async bumpReservationVersions(shipmentIds: readonly string[], tx: DbTx): Promise<void>;
  ```
- **분할:** 호출자의 사전 검사(버전·draft·`splitUnreserved` 의 복구 코드·합배송)는 문 밖에 지금 순서대로 둔다. `assertNoCustodyOrActiveWork`·`assertNoActiveWaybill` 호출을 지우고 그 자리에서 `editShipmentManifest(deps, { shipmentIds:[shipmentId], allow:['draft'] }, body, tx)`. 줄 단위 검사(`Shipment line … is not in`, `SHIPMENT_LINE_STALE_VERSION`, 수량)와 예약 목표 계산은 body 안 맨 앞. `applySplit` 은 body 의 나머지: `writer.createShipment`(원본의 창고·프로필·수령인·비밀번호, `openedBy`), 통째 이동 `writer.moveLine`, 일부 이동 `loadReservationQueueKey` → `writer.setLineQty` → `writer.addLine`(`createdFromLineId`·`demandRequestedAt`) → `reservations.transfer`. 통째 이동에 예약이 있으면 `reservations.bumpReservationVersions([shipmentId, target.id])`. manifest·재계산 코드는 지운다(끝맺음이 한다). 오퍼레이션·감사·응답은 문이 끝난 뒤.
- **취소 줄이기:** `applyDraftCancellation` 을 `editShipmentManifest(deps, { shipmentIds:[aggregate.shipment.id], allow:['draft'] }, …)` 로 감싼다. body 는 문이 준 **새로 잠근** aggregate 의 줄로 `selected` 를 다시 맞춘 뒤(같은 id, 최신 `qty`·`lineVersion`) `shrinkDraftLines(…, writer, …)` 와 FO 항목 `canceledQty` 증가를 한다. 전량이면 문 다음에 `transitionShipments(draft→canceled)` 와 **`reservations.recompute(shipmentId)`**(지금 무조건 부르는 재계산 — 문은 줄이 안 바뀌면 부르지 않는다). 일부면 Task 5 의 임시 manifest 쓰기를 지운다(끝맺음이 한다). 묘비 재계산 코드도 지운다.
- **구성 수정(amend):** draft 검사 뒤 두 가드 호출을 지우고 문으로 감싼다. 늘림·줄임 줄 쓰기는 `writer.setLineQty`/`writer.addLine`, 줄임은 `shrinkDraftLines(…, writer, …)`, 프로필은 `writer.setShippingProfile`. 끝의 manifest·재계산 코드는 지운다. 반환 `manifestVersion` 은 문 뒤에 다시 읽은 값.

- [ ] **Step 1: 실행해 기준을 잡는다.** `IT` shipment-planning·batch-cancel-withdraw·draft-box-amender·fulfillments.line-composition·outbound-v2-scenarios 의 `.integration.spec.ts` → PASS(Task 5 상태)
- [ ] **Step 2: 세 경로를 위대로 바꾼다.**
- [ ] **Step 3: 실행** — Step 1 의 목록 + `reservation-queue-key`·`channel-order-change`(sales-order) 의 `.integration.spec.ts`, `npx jest apps/core/src/modules/fulfillment apps/core/src/modules/sales-order`
  Expected: 전부 PASS, 특성 테스트 기대값 변경 없음.
- [ ] **Step 4: 커밋** `refactor(fulfillment): 분할·취소 줄이기·구성 수정을 구성 편집의 문으로 (K2)`

---

### Task 8: 수령인 정정·합배송 활성화·상자 생성

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts:89-158`(`resolveRecipientRevision`), `:338-499`(정정 둘)
- Modify: `.../services/shipment-planning.service.spec.ts:155-210`(`resolveRecipientRevision` 단언)
- Modify: `.../services/consolidation.service.ts:602-806`(활성화), `:808-829`(잠금)
- Modify: `.../services/shipment-reservation.service.ts`(`retargetConfirmed` 추가)
- Modify: `.../services/fulfillments.service.ts:281-303`

**Interfaces:**
- Consumes: Task 3 의 `openShipment`·`transitionShipments`, Task 6 의 `editShipmentManifest`·`lockShipmentAggregates`, Task 7 의 `bumpReservationVersions`.
- Produces:
  ```ts
  // RecipientRevisionUpdate 에서 manifestVersion 을 뺀다(문이 올린다). snapshotChanged·passwordChanged 는 그대로.
  export type RecipientRevisionUpdate = { recipientSnapshot?: unknown; entrancePassword?: string };
  // ShipmentReservationService
  /** 원본 줄들의 확정 예약을 대상 줄로 옮기고(targetId·shipmentLineId), 원본 줄 reserved_qty 를 0 으로. */
  async retargetConfirmed(sourceLineIds: readonly string[], targetLineId: string, tx: DbTx): Promise<void>;
  ```
- **정정 둘:** 사전 검사는 지금 순서대로 문 밖. 가드 두 호출 자리에서 문(운영자 `allow:['draft']`, 채널 `allow:['draft','planned']`). 채널의 `assertRecipientComplete`(planned 일 때)는 body 맨 앞. body: `createOperation` → `snapshotChanged` 면 `writer.reviseRecipient`, `passwordChanged` 면 `writer.setEntrancePassword`. 문 뒤: `invariant.assertFulfillmentOrders` → after 스냅샷 → `completeOperation` → 감사(지금 순서). `shipment-planning.service.spec.ts` 의 `manifestVersion` 단언 셋은 `snapshotChanged` 단언으로 바꾸고 `update` 에 `manifestVersion` 키가 없음을 단언한다.
- **합배송:** `lockAggregates` 를 `lockShipmentAggregates(tx, this.invariant, ids, () => this.conflict('CONSOLIDATION_COMPONENT_CHANGED_RETRY', 'Shipment membership changed while acquiring locks'))` 로 바꾸고 private 메서드를 지운다. 활성화는 `editShipmentManifest(deps, { shipmentIds: sourceIds, allow:['draft','planned','recovery_required'] }, body)`. body 순서(지금과 같다): `writer.createShipment`(대상) → FOI 묶음마다 `writer.addLine`(**`reservedQty` 없이** — 끝맺음의 재계산이 확정 예약 합으로 채운다) + `reservations.retargetConfirmed(sourceIdsForLine, targetLine.id)` → `transitionShipments({ shipmentIds: sourceIds, from: 원본 상태 집합, to:'superseded', expect:{ recoveryCode:'CONSOLIDATION_PENDING' }, at: now, stale:'unreachable' })` → `reservations.bumpReservationVersions([...sourceIds, target.id])`. **원본을 superseded 로 바꾼 뒤에 대상 재계산이 와야 한다** — 재계산이 불변식을 검사하는데, 예약이 빠진 planned 원본이 살아 있으면 «planned 는 전량 예약» 불변식이 깨진다. 끝맺음의 재계산은 body 뒤라 이 순서가 지켜진다. 오퍼레이션 멤버·감사·응답은 문 뒤.
- **상자 생성:** `fulfillments.service.ts:281-303` 의 두 insert 를 `openShipment(trx, { warehouseId, status:'draft', shippingProfileId, recipientSnapshot, entrancePassword }, lines)` 하나로. 뒤의 예약·재계산은 그대로.

- [ ] **Step 1: 단위 spec 기대값을 바꾼다**(`resolveRecipientRevision` 셋) → `npx jest .../shipment-planning.service.spec.ts` FAIL
- [ ] **Step 2: 위대로 바꾼다.**
- [ ] **Step 3: 실행**
  Run: `IT` shipment-planning·shipment-recipient-from-channel·consolidation(특히 `serializes different-key concurrent consolidation`)·fulfillments.line-composition·fulfillment-order-item-qty-zero·outbound-v2-scenarios 의 `.integration.spec.ts` + `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts`, 그리고 `npx jest apps/core/src/modules/fulfillment apps/core/src/modules/sales-order`
  Expected: 전부 PASS, 특성 테스트(합배송 planned·채널 정정 거절 포함) 기대값 변경 없음.
- [ ] **Step 4: 커밋** `refactor(fulfillment): 수령인 정정·합배송·상자 생성을 커널로, 합배송 예약 쓰기는 예약 서비스로 (K2)`

---

### Task 9: 우회 금지 가드

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-writes.guard.spec.ts`

**Interfaces:** K1 의 `picking/work-item-command.guard.spec.ts` 처럼 TypeScript AST 로 `apps/core/src` 의 `.ts`(`.spec.ts`·`__support__/` 제외)를 걷는다. 커널 폴더 `modules/fulfillment/shipment/` 는 검사하지 않는다.

- 규칙(커널 밖):
  - `.insert(E)`·`.delete(E)` 에서 `E` 가 `…shipments` 또는 `…shipmentLines` 속성 접근이면 위반.
  - `.update(E).set(O)` 에서 `E` 가 `…shipments`: `O` 가 객체 리터럴이 아니면(스프레드·변수) 위반. 키는 `lastUpdated` 어디서나, `reservationVersion` 은 `services/shipment-reservation.service.ts` 만, `entrancePassword` 는 값이 `null` 리터럴이고 파일이 `services/shipment-delivery-tracking.service.ts`·`sales-order/services/entrance-password-cleaner.ts` 일 때만. 그 밖의 키는 위반.
  - `.update(E).set(O)` 에서 `E` 가 `…shipmentLines`: 객체 리터럴만, 키는 `reservedQty` 는 `shipment-reservation.service.ts` 만, `inspectedQty`·`forced`·`lineVersion` 은 `services/shipment-dispatch.service.ts`·`services/box-allocation.manager.ts` 만.
  - 변수 초기화식이 `…shipments`·`…shipmentLines` 속성 접근이면(별칭) 위반 — 별칭으로 위 규칙을 피하지 못하게.
  - 템플릿 리터럴·문자열에 `/\b(update|insert\s+into|delete\s+from)\s+"?shipment(s|_lines)\b/i` 가 있으면 위반.
- 위반은 `파일:줄 — 이유` 목록으로 모아 `toEqual([])` 로 단언한다.

- [ ] **Step 1: 가드를 쓰고, 일부러 깨 본다.** 임시로 `consolidation.service.ts` 에 `await tx.update(wmsTables.shipments).set({ status: 'draft' })…` 한 줄을 넣고 `npx jest .../shipment-writes.guard.spec.ts` → FAIL(그 줄이 목록에 나옴). 별칭(`const s = wmsTables.shipmentLines`)과 raw SQL 문자열로도 한 번씩. 확인 뒤 임시 줄을 지운다.
- [ ] **Step 2:** 같은 명령 → PASS
- [ ] **Step 3: 커밋** `test(fulfillment): K2 상자 쓰기 우회 금지 가드`

---

### Task 10: ADR·원본 교정·게이트

**Files:**
- Create: `docs/adr/0046-shipment-state-and-manifest-share-one-kernel.md`
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 의 K2 항목
- Modify: `docs/superpowers/specs/2026-10-19-k2-shipment-lifecycle-design.md` — 구현 중 §8·§9 에 더한 것이 있으면 반영

- ADR 내용(0045 의 형식을 따른다): Status Accepted(날짜), 출발점(감사 §8.1·설계). Context: 12파일·흩어진 리셋·«호출자 몫» 주석. Decision: 전이 함수·전이표 14행·0행 정책 셋, 문·끝맺음 규칙(비밀번호는 안 올림·줄 바뀐 상자만 재계산), 예약 누수 두 곳, 가드. 이름 붙은 동작 변경 D1·D2. 커널에 넣지 않은 것(오퍼레이션 기록, 검수 전진, 비밀번호 파기, 추적 해석, `failed` enum).
- 감사 §8.1 K2: «소유하는 것» 을 «상태 전이 + 구성(줄·수령인·프로필·manifestVersion)» 으로, 끝에 «ADR-0046 으로 완료(2026-10-…)» 한 줄.

- [ ] **Step 1: 문서를 쓴다.**
- [ ] **Step 2: 전체 게이트**
  Run: `npm run type-check` → 에러 0. `npx jest` → 실패 0. `IT` 이 계획이 건드린 모든 `.integration.spec.ts` 와 `apps/core/src/modules/fulfillment/**/*.integration.spec.ts` 전체.
  Expected: 전부 0 / PASS.
- [ ] **Step 3: 커밋** `docs(adr): 0046 상자 상태·구성은 커널 하나를 지난다 — 감사 §8.1 K2 교정`
