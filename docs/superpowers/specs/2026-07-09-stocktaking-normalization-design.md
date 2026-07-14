# 실사(Stocktaking) 정상화 설계 (작업 1 / WS-A)

> 상위 상황판: `docs/logistics-backend-hardening-2026-07.md` §5 WS-A.
> 대상 결함: **P0-2**(원장 우회 직접 INSERT) · **P0-3**(멱등성 부재) · **W3**(complete↔조정 순서·원자성) · **W2**(세션 취소 부재) · **P2-5**(라인 unique 부재) + **P0-2 회귀 방지 아키텍처 테스트** + **P2-6의 실사 경로만**(스냅샷 드리프트).
> 작성일 2026-07-09. 착수 전 현장 재확인 완료(코드 직접 열람).

---

## 1. 배경 / 문제

실사 조정은 `stocktaking.service.ts:361-374`에서 `tx.insert(stockEvents)`로 **원장(`StockEventStore`)을 우회한 직접 INSERT**를 한다. 결과:

- `stock_ledgers` projection이 갱신 안 됨 → 실사를 확정해도 **시스템 재고가 변하지 않음**. `stocktakingAdjustments.stockEventId`는 원장에 반영되지 않은 유령 이벤트를 참조.
- 판매가능수량 재계산·transactional outbox도 누락.
- ADJUST_DOWN 이벤트가 `fromWarehouseId/fromLocationId`를 비운 채 `fromState:'ON_HAND'`만 세팅 → `applyProjection` 검증에 걸리는 malformed shape(정상 경로로 배선하는 순간 드러남).

부수 결함:

- **P0-3**: `generateAdjustments`가 세션 상태를 읽지도 쓰지도 않고 멱등 장치가 없음 → 2회 호출 시 이벤트·조정 2배.
- **W3**: `generateAdjustments`와 `completeSession`의 순서·원자성이 미정의(확정 전 조정 가능, 확정 후 재조정 가능).
- **W2**: `cancelled` 세션 상태 enum은 있으나 세터/라우트가 없어 dead value.
- **P2-5**: `stocktaking_lines`에 `(session, sku, location)` unique가 없어 재스캔·동시 실사 시 라인 중복.

### 확정된 기술 사실 (재검증)

- `InventoryCommandService.adjustUp/adjustDown(input, tx?)`는 `{ skuId, warehouseId, locationId?, quantity, occurredAt?, idempotencyKey?, reason? }`를 받으며 **명시적 로케이션 grain 지원** + 부족분 400 검증 + `StockAdjusted` **outbox emit**을 수행한다(`inventory-command.service.ts:264~464`). 실사 조정 재배선의 정확한 타깃.
- `createEvent` 자체는 outbox를 enqueue하지 않는다 — outbox는 상위 래퍼 `InventoryCommandService`가 넣는다. 따라서 조정은 bare `createEvent`가 아니라 **`adjustUp/adjustDown`**으로 배선해야 ledger+sellable+outbox가 한 tx에 산다.
- `stock_events.idempotencyKey`는 `varchar(128).unique()` + `createEvent`의 `onConflictDoNothing` → 결정적 키를 넘기면 재실행이 원장 이중적용 없이 no-op.
- `stocktakingLines.status`는 enum이 아닌 **자유 varchar(20)** → `'adjusted'` 추가에 마이그레이션 불요.
- `stocktakingLines.locationId`는 **nullable** → unique는 `NULLS NOT DISTINCT` 필요.
- `stocktakingAdjustments`에 `appliedBy`(uuid), `stockEventId`(nullable FK), `adjustmentType`(varchar 'INCREASE'/'DECREASE')가 이미 존재.

---

## 2. 목표 / 비목표

**목표**
1. 모든 실사 조정을 `InventoryCommandService.adjustUp/adjustDown`으로 통과 — 원장 우회 제거(P0-2).
2. 조정 적용을 **완료(complete) 시점 단일 tx로 원자화**(W3) → 순서·부분상태·재조정 문제 소멸.
3. 멱등 보장(P0-3): 종결 상태 가드 + 결정적 idempotencyKey + 조정 unique.
4. 세션 취소(W2) 신설, 상태기계 확립.
5. 라인 unique(P2-5)로 중복 방지.
6. 원장 우회 재도입을 막는 아키텍처 테스트(P0-2 회귀 가드).
7. 완료 시 **라이브 delta**로 원장을 정확히 실사 카운트에 맞춤(실사 경로 한정 P2-6 해소).

**비목표(후속)**
- P2-14 events↔ledgers reconcile 잡(작업 2).
- P0-4(inventory-correction dead code), P2-2(sku-location-movement dead code).
- admin-web 다듬기(버튼 라벨/취소 버튼/라이브 delta 표시) — 별도 FE 티켓.
- P2-6 일반(비-실사 variance 경로).
- 실사 하향조정이 만들 수 있는 `on_hand < reserved`는 **막지 않는다**(물리 진실 반영). P2-14 reconcile가 알림으로 탐지할 영역.

---

## 3. 상태기계

### 세션 (`stocktaking_sessions.status`, enum 값 전부 기존재)

```
∅ ─create→ draft ─start→ in_progress ─complete→ completed   (complete가 조정 원자 적용)
                    │            │
                    └── cancel ──┴──────────────→ cancelled
completed / cancelled = 종결 상태(모든 상태변경·카운트 거부)
```

| 전이 | 메서드 | 가드 |
|---|---|---|
| ∅ → draft | `createSession` | — |
| draft → in_progress | `startSession` | status=draft |
| in_progress → completed | `completeSession` | status=in_progress (조정 원자 적용, §5) |
| draft·in_progress → cancelled | `cancelSession` **(신설)** | status ∈ {draft, in_progress} |

- `completeSession`·`cancelSession`은 진입 시 세션 row를 `SELECT … FOR UPDATE`로 잠가 동시성 직렬화(중복 complete, complete-vs-cancel 경합 차단 — **P0-3 핵심**).
- **스캔/카운트 가드 신설**: `scanLocation`·`scanProduct`·`updateCount`는 대상 세션이 `in_progress`가 아니면 `BadRequestError`. (현재 무가드 — 완료/취소 세션도 스캔됨.)
- `generateAdjustments`(미리보기)는 read-only이므로 `in_progress`에서 허용.

### 라인 (`stocktaking_lines.status`, 자유 varchar)

`pending`(scanLocation 생성) → `counted`(scan/update) → **`adjusted`**(complete 적용 완료 표식, 신규). 마이그레이션 불요.

---

## 4. 엔드포인트 계약 변화

| 라우트 | Before | After |
|---|---|---|
| `POST /stocktaking/sessions/:id/generate-adjustments` | 원장 우회 INSERT(영속) | **dry-run 미리보기(무영속)**. 응답 shape 하위호환 유지: `{ adjustmentsCreated, eventsPosted, message }`(값=예정치) + `preview: PreviewItem[]` 추가. `GenerateAdjustmentsDto.lineIds?` 필터 존중. |
| `POST /stocktaking/sessions/:id/complete` | 요약만 리턴 | **조정 원자 적용 + 종결**(§5). 응답 shape 유지(`summary.adjustmentsApplied`=실제 적용 수). |
| `POST /stocktaking/sessions/:id/cancel` | 없음 | **신설**. `draft`·`in_progress` → `cancelled`, 원장 무접촉. 종결 상태면 `BadRequestError`. |

**admin-web 호환**: 현행 UI는 "조정 일괄 생성"(generate) 후 "실사 완료"(complete)를 순차 클릭하며 generate 응답의 `message`만 토스트로 쓴다. generate가 미리보기로 격하돼도 결과적으로 complete가 적용하므로 **동작 손실 없음**(구버전 generate는 원장을 우회해 실제 적용된 적도 없음). 응답 shape 유지 → admin-web 무변경. `cancel`은 순수 추가.

`PreviewItem` DTO(별도 클래스, `@ApiProperty({ type: 'object' })` 금지 규칙 준수):
```
{ lineId, skuId, locationId, countedQuantity, currentOnHand, delta, adjustmentType }
```
delta는 §5와 동일한 라이브 계산.

---

## 5. 적용 메커니즘 — `completeSession` (한 tx)

```
run(tx):
  session = SELECT * FROM stocktaking_sessions WHERE id=:id FOR UPDATE
  if !session               → NotFoundError
  if session.status != 'in_progress' → BadRequestError   # 종결/미시작 차단 = 멱등
  lines = SELECT * FROM stocktaking_lines
          WHERE session_id=:id AND variance != 0 AND counted_quantity IS NOT NULL
          FOR UPDATE
  applied = 0
  for line in lines:
    current = SELECT qty FROM stock_ledgers
              WHERE sku=line.sku AND warehouse=session.warehouse
                AND location=line.location AND state='ON_HAND'   (없으면 0)
    delta = line.counted_quantity - current            # 라이브 재계산 → 원장이 정확히 counted
    if delta == 0: line.status='adjusted'; continue
    key = `stocktaking:${session.id}:${line.id}`
    if delta > 0:
      { eventId } = InventoryCommandService.adjustUp(
        { skuId, warehouseId: session.warehouse, locationId: line.location,
          quantity: delta, idempotencyKey: key, reason: `stocktaking:${session.id}` }, tx)
    else:
      { eventId } = InventoryCommandService.adjustDown(
        { …, quantity: -delta, idempotencyKey: key, … }, tx)
    INSERT stocktaking_adjustments
      (session_id, line_id, stock_event_id=eventId, adjustment_quantity=abs(delta),
       adjustment_type= delta>0?'INCREASE':'DECREASE', reason, applied_by)
      ON CONFLICT (line_id) DO NOTHING
    line.status = 'adjusted'; applied++
  UPDATE stocktaking_sessions SET status='completed', completed_at=now()
  return summary{ totalLines, discrepanciesFound, adjustmentsApplied: applied }
```

**원자성**: adjustUp/Down이 이벤트 append + `stock_ledgers` projection + sellable 재계산 + outbox enqueue를 같은 `trx`로 수행. 조정·라인상태·세션종결이 전부 한 커밋 → 부분상태 불가능(W3 해소).

**멱등**(P0-3):
1. `status != 'in_progress'` 가드 + `FOR UPDATE` → 세션 레벨 단발 보장.
2. 결정적 `idempotencyKey`(`stocktaking:{session}:{line}`) → 크래시-재시도 시 `stock_events.idempotencyKey` unique가 원장 이중적용 방어.
3. `stocktaking_adjustments(line_id)` unique + `ON CONFLICT DO NOTHING` → 조정 row 중복 방어.

**라이브 delta**(실사 P2-6): 완료 시점 원장을 다시 읽어 `delta = counted − 현재 ON_HAND` → 스캔~완료 사이 재고 이동이 있어도 최종 ON_HAND가 정확히 `counted`. 스냅샷 variance를 그대로 쓰면(구현) adjustDown의 `현재고 ≥ 차감량` 검증에 spurious 400이 날 수 있는데, 라이브 delta는 `delta_down = current − counted ≤ current`(counted ≥ 0)이라 이 가드를 항상 통과.

**잔여 동시성**: 내가 읽은 `current`와 adjust 내부 재검증 사이의 극소 race는 adjustDown의 `gte` 조건부 UPDATE가 fail-loud(400)로 잡는다 → 완료 재시도. 실사(특정 시점 카운트)의 tolerance 내이며, 저장된 스냅샷보다 항상 더 정확.

---

## 6. 스키마 변경 (마이그레이션 1개)

`apps/core/src/modules/inventory/schema/inventory.schema.ts` 편집 후 `npm run db:generate:core -- --name stocktaking-uniques`.

1. `stocktaking_lines`: **unique index `(session_id, sku_id, location_id)` `NULLS NOT DISTINCT`**(drizzle `uniqueIndex().on(...).nullsNotDistinct()`) — P2-5.
2. `stocktaking_adjustments`: **unique `(line_id)`** — P0-3 조정 방어.
3. 라인 status `'adjusted'`는 varchar라 스키마 무변경(코드에서만 사용).

**⚠️ 기존 데이터 dedup**: 위 unique는 현재 데이터가 위반하면 생성 실패한다. 실사 테이블은 사실상 신규(감사서 broken 확인)라 dev에선 no-op일 것으로 보이나, 마이그레이션 SQL에 **멱등 dedup(그룹별 최신 1건 keep, 나머지 DELETE) 선행 블록**을 넣어 안전화. `stocktaking_lines`·`stocktaking_adjustments` 둘 다 하위 FK 참조가 (adjustments→line 외엔) 없어 dedup 안전.

**ADR-0005 판단**: unique 추가는 엄밀히는 데이터 위반 가능한 변경이나, dedup을 같은 마이그레이션에 포함하면 단일 PR로 안전. **운영 DB에 실 실사 데이터가 있으면** phase 분리(선-dedup 배포 → 후-constraint)를 검토 — 착수 시 확인 필요.

---

## 7. 아키텍처 테스트 (P0-2 회귀 봉인)

`apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts` (신규):

- inventory 모듈 `**/*.ts`를 fs 스캔, `stock-event.store.ts`와 `*.spec.ts` 제외.
- 정규식 `\.insert\(\s*(wmsTables\.)?stock(Events|Ledgers)\b` 및 `\.update\(\s*(wmsTables\.)?stockLedgers\b` 매칭 시 **fail**(위반 파일:라인 나열).
- 기존 Jest 인프라(`testRegex: .*\.spec\.ts$`, roots `apps/`)에 그대로 편승 — 신규 의존성 불요.
- P0-2 수정 전엔 `stocktaking.service.ts` 위반으로 **red**, 수정 후 **green**. 향후 재도입 영구 차단.

---

## 8. 테스트 계획 (TDD — 실사 테스트 전무, 신규 작성)

작성 순서(각 단계 red→green):

1. **아키텍처 테스트**(§7) — 현재 red. P0-2 배선 교체로 green.
2. **완료 원자 적용**(통합): variance 라인 있는 세션 complete → `stock_ledgers` 변동, `stock_summary_view` 반영, `outbox`에 `StockAdjusted` row, `stocktaking_adjustments` 생성, 라인 `status='adjusted'`, 세션 `completed`. 전부 한 tx.
3. **라이브 delta**: 스캔 후·완료 전 해당 SKU 원장을 이동시켜도 완료 후 ON_HAND == counted(스냅샷 variance가 아님) 검증.
4. **멱등**: (a) complete 2회 → 2번째 `BadRequestError`(종결 가드). (b) 동일 idempotencyKey 재-createEvent가 이중적용 안 함(원장 불변).
5. **상태기계**: cancel(draft/in_progress) OK, cancel(completed) reject, 비-in_progress에서 scan/count reject.
6. **P2-5**: 같은 위치 scanLocation 2회 → 라인 중복 없음(onConflictDoNothing + unique).
7. **하향 가드**: 현재고보다 큰 하향 delta 상황에서 adjustDown fail-loud(400) 확인.

---

## 9. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `stocktaking/services/stocktaking.service.ts` | `completeSession` 원자 적용 재작성, `generateAdjustments`→미리보기, `cancelSession` 신설, scan/count 상태가드, `scanLocation` onConflictDoNothing |
| `stocktaking/controllers/stocktaking.controller.ts` | `POST …/cancel` 라우트 추가 |
| `stocktaking/stocktaking.module.ts` | InventoryCommandService 제공 모듈 import, 서비스 주입 |
| `stocktaking/dto/*.ts` | `PreviewItem` DTO(별도 클래스) 추가 |
| `schema/inventory.schema.ts` | 라인·조정 unique 추가 |
| `drizzle/<ts>_stocktaking-uniques.sql` | dedup 선행 + unique 생성 |
| `inventory/inventory-write-boundary.arch.spec.ts` | 신규 아키텍처 테스트 |
| `stocktaking/**/*.spec.ts` | 신규 상태기계·적용·멱등·라이브delta 테스트 |

---

## 10. 오픈 체크포인트 (착수 시)

1. **운영 실사 데이터 유무** — 있으면 §6 unique를 phase 분리.
2. `InventoryCommandService`를 export하는 정확한 모듈 확인(주입 배선).
3. adjustUp/adjustDown이 `occurredAt` 미지정 시 `new Date()` 기본값을 쓰는지 확인(실사 `occurredAt` 시맨틱).
