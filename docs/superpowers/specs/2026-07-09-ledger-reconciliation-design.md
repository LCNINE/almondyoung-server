# 원장 대사(Ledger Reconciliation) 잡 설계 (P2-14 / WS-A)

> 스프린트 허브: `docs/logistics-backend-hardening-2026-07.md` — WS-A "원장 쓰기 단일화 강제" 잔여 항목.
> 선행: 작업 1(실사 정상화, `e9ce5597d`)에서 `inventory-write-boundary.arch.spec.ts`(정적 쓰기 경계 봉인) 신설 완료. 본 작업은 그 **런타임/데이터 레벨 짝**이다.

## 1. 배경 / 문제

`stock_ledgers.qty`(파생 projection)는 `StockEventStore.applyProjection`(`core/repositories/stock-event.store.ts:106-179`)이 이벤트 생성 시마다 증분 유지한다. 진실은 `stock_events`(append-only). 이 둘이 어긋나면(누군가 원장을 우회해 이벤트/원장을 건드림 — 정확히 P0-2 실사 직접 INSERT가 만들던 사고) 이를 **탐지할 런타임 장치가 없다.**

현재 존재하는 유일한 관련 primitive는 `calculateQuantityAsOf`(`stock-event.store.ts:204`)뿐이며, grain 1개를 알 때 그 수량을 이벤트에서 재계산한다. 호출처 0건(미사용). 전체 대사 잡·엔드포인트·테스트는 전무.

`inventory-write-boundary.arch.spec.ts`는 소스 레벨에서 "`stock-event.store.ts` 외의 코드는 `stock_events`/`stock_ledgers`에 직접 쓰지 못한다"를 봉인하지만, 이는 **정적** 방어다. 마이그레이션·수기 SQL·과거 데이터·미래의 우회가 남긴 데이터 drift는 잡지 못한다.

### 확정된 기술 사실 (재검증 2026-07-09)

- **불변식**: `stock_ledgers.qty == Σ(grain으로 들어온 이벤트 qty) − Σ(grain에서 나간 이벤트 qty)`. grain = `(skuId, warehouseId, locationId, stockState)` = `stock_ledgers` PK(`schema:841`).
- **이벤트의 grain 기여**: 이벤트 1건은 최대 2개 grain에 기여 — `toState` 있으면 `(skuId, toWarehouseId, toLocationId, toState)`에 `+quantity`, `fromState` 있으면 `(skuId, fromWarehouseId, fromLocationId, fromState)`에 `-quantity`. (`applyProjection` 로직과 동형.)
- **`voided`/`eventStatus` 필터는 미래 방어용**: 전 코드베이스에서 `voidedByEventId`·`eventStatus='VOIDED'/'PENDING'`을 **쓰는 경로가 없다**(모든 이벤트가 `POSTED`·`voided=NULL`로 생성; `stock-event.store.ts:69,331`). 역분개(`reverseEvent:300`)도 원본을 void 처리하지 않고 반대 이벤트를 추가해 netting한다. 따라서 `Σ(POSTED·non-void 이벤트) == 원장.qty`가 현재 데이터에서 깔끔히 성립. 필터(`eventStatus='POSTED' AND voidedByEventId IS NULL`)는 `calculateQuantityAsOf`와 동일하게 유지 — `applyProjection`이 반영한 것과 정확히 일치시켜 미래 오탐 방지.
- **모듈 배선 공백 없음**: `CoreInventoryModule`이 `ScheduleModule.forRoot()`와 `SharedModule`(→`MetricsService` export)을 이미 import. 크론 서비스 선례 `ReservationCronService`가 같은 모듈 providers에 존재.

## 2. 목표 / 비목표

**목표**
- `stock_events`(진실) ↔ `stock_ledgers`(파생)를 대사해 drift grain을 **탐지·리포트**하는 안전망 신설.
- 야간 크론(자동) + 관리자 온디맨드 엔드포인트(수동) 두 진입점.
- drift를 로그 + Prometheus 게이지로 관측 표면화(다운스트림 알람 룰이 알림).
- drift 탐지 회귀 스펙(데이터 레벨) 신설.

**비목표**
- **수리(repair)** — 원장을 이벤트 파생값으로 재동기화하는 자동/수동 경로. 별도 PR. (이유: 이벤트 쪽이 손상된 경우 원장을 이벤트에 맞추는 수리가 오히려 진짜 재고를 왜곡하고 진짜 버그를 마스킹.)
- **스냅샷 영속** — drift 이력 테이블. Prometheus 게이지 시계열이 이력을 대신하므로 중복(YAGNI). 마이그레이션 없음.
- **Prometheus 알람 룰 설정** — 인프라(모니터링 스택) 소관.
- **`stock_summary` 뷰 대사** — 뷰(`stock_summary_view`, `schema:849`)라 `stock_ledgers` 위 순수 파생. 독립 drift 없음.
- **예약 대사**(`reserved ≤ on_hand` 등) — WS-C 소관(P1-4/P1-5).
- **역할 기반 인가** — P3-6(전역 미구현). 엔드포인트는 인증만.

## 3. 대사 쿼리 (핵심)

이벤트를 grain 단위로 unpivot(to에 `+qty`, from에 `-qty`) → GROUP BY로 파생 수량 계산 → `stock_ledgers`와 FULL OUTER JOIN → 불일치 행만 반환.

```sql
WITH derived AS (
  SELECT sku_id, wh, loc, state, SUM(q) AS derived_qty FROM (
    SELECT sku_id, to_warehouse_id AS wh, to_location_id AS loc, to_state AS state, quantity AS q
      FROM stock_events
     WHERE event_status = 'POSTED' AND voided_by_event_id IS NULL AND to_state IS NOT NULL
    UNION ALL
    SELECT sku_id, from_warehouse_id, from_location_id, from_state, -quantity
      FROM stock_events
     WHERE event_status = 'POSTED' AND voided_by_event_id IS NULL AND from_state IS NOT NULL
  ) g
  GROUP BY sku_id, wh, loc, state
)
SELECT
  coalesce(d.sku_id, l.sku_id)             AS sku_id,
  coalesce(d.wh, l.warehouse_id)           AS warehouse_id,
  coalesce(d.loc, l.location_id)           AS location_id,
  coalesce(d.state, l.stock_state)         AS stock_state,
  coalesce(d.derived_qty, 0)               AS derived_qty,
  coalesce(l.qty, 0)                       AS ledger_qty
FROM derived d
FULL OUTER JOIN stock_ledgers l
  ON  d.sku_id = l.sku_id AND d.wh = l.warehouse_id
  AND d.loc = l.location_id AND d.state = l.stock_state
WHERE coalesce(d.derived_qty, 0) <> coalesce(l.qty, 0)
  -- 선택적 필터: :warehouseId / :skuId 있으면 AND 로 좁힘
```

**설계 근거**
- **단일 `sql` 문 = 단일 스냅샷.** 이벤트 집계와 원장 읽기를 한 statement로 묶어 read-skew(집계 도중 이벤트 커밋) 오탐을 원천 차단. grain마다 별도 쿼리를 도는 방식(N× `calculateQuantityAsOf`)은 오탐 + O(grain수) 풀스캔이라 배제.
- **`sql` raw 사용 정당화.** Drizzle 쿼리 빌더는 `UNION ALL` 하위쿼리의 GROUP BY + `FULL OUTER JOIN`을 깔끔히 표현하지 못한다. 읽기 전용 aggregation이며, 기존 `calculateQuantityAsOf`도 동일하게 `sql<number>`를 쓴다. `inventory-write-boundary.arch.spec.ts`는 쓰기(`.insert`/`.update`)만 봉인하므로 저촉 없음. 결과는 명시 타입으로 매핑(`any` 금지).
- **`coalesce(...,0) <> coalesce(...,0)`** 로 정상적으로 0이 된 grain(전량 소진 후 잔존 row) 및 한쪽만 존재하는 grain의 오탐 차단.
- `ix_stock_events_grain_time`(`schema:804`) 존재 — 야간 배치엔 충분.

**결과 형태**
```ts
type LedgerDriftSeverity = 'CRITICAL' | 'MISMATCH';

interface LedgerDriftRow {
  skuId: string; warehouseId: string; locationId: string;
  stockState: StockStateEnum;
  derivedQty: number;   // 이벤트 파생값 (진실)
  ledgerQty: number;    // 원장 저장값
  delta: number;        // ledgerQty - derivedQty
  severity: LedgerDriftSeverity;
}

interface LedgerReconciliationReport {
  checkedAt: Date;
  totalDriftGrains: number;
  criticalCount: number;
  drifts: LedgerDriftRow[];
}
```
- `severity='CRITICAL'`: `derivedQty < 0`(이벤트 데이터 손상 신호) — `ck_ledgers_non_negative`(`schema:842`)로 원장은 음수 불가이므로 파생이 음수면 이벤트 원장 자체가 깨진 것.
- `severity='MISMATCH'`: 그 외 수량 불일치.
- `delta = ledgerQty − derivedQty` (양수 = 원장 과다, 음수 = 원장 과소).

## 4. 컴포넌트 (신규 — 마이그레이션 없음)

| 파일 | 역할 |
|---|---|
| `core/services/ledger-reconciliation.service.ts` (신규) | **핵심.** `reconcile(filter?: { warehouseId?; skuId? }): Promise<LedgerReconciliationReport>` 순수 메서드(§3 단일 쿼리 실행 → 리포트). `@Cron` 야간 래퍼 `scheduledReconcile()`가 `reconcile()` 호출 → 로그 + 메트릭. `@InjectTypedDb<typeof wmsSchema>()` + `MetricsService` 주입. |
| `core/controllers/ledger-reconciliation.controller.ts` (신규) | `GET /inventory/ledger-reconciliation` (옵션 query `warehouseId`, `skuId`) → `reconcile(filter)` 결과 JSON. 글로벌 JWT 가드(`@Public` 아님). 응답 DTO는 중첩 클래스로 정의(`@ApiProperty({ type:'object' })` 금지 — inventory 규칙). |
| `shared/services/metrics.service.ts` (수정) | Gauge `wms_ledger_drift_grains{severity}` + 메서드 `setLedgerDrift({ mismatch, critical })` 추가. 매 실행 후 set(정상 시 0) → Prometheus 알람(`> 0`)이 알림 표면. |
| `core/inventory.module.ts` (수정) | 신규 service를 `providers`, 신규 controller를 `controllers`에 등록. `MetricsService`는 이미 import된 `SharedModule`에서 주입 가능. |

## 5. 크론 + 관측

- `@Cron('0 3 * * *', { name: 'ledger-reconciliation', timeZone: 'Asia/Seoul' })` → `scheduledReconcile()` → `reconcile()`.
- **drift > 0**: `logger.error`로 요약(총 grain 수, critical 수) + grain 목록. 로그가 목록을 캡하면 **총 건수를 명시**(silent truncation 금지). `metricsService.setLedgerDrift({ mismatch, critical })`.
- **drift = 0**: `logger.log`(정상) + 게이지 0으로 set.
- 크론 본문은 try/catch로 감싸 잡 자체 예외가 스케줄러를 죽이지 않게(선례 `purchase-order-cron.service.ts:72` 동일).
- 별도 Slack/Sentry 인프라 없음 → 로그 + Prometheus 게이지가 유일한 알림 표면.

## 6. 엔드포인트 계약

```
GET /inventory/ledger-reconciliation?warehouseId=<uuid>&skuId=<uuid>
→ 200 LedgerReconciliationReport (drift 없으면 totalDriftGrains=0, drifts=[])
```
- 인증: 글로벌 `APP_GUARD` JWT. `@Public` 아님. role-gate 없음(P3-6, 후속).
- 필터 없으면 전 카탈로그 대사. 온디맨드 진단용이라 재계산 비용 감수(빈도 낮음).

## 7. 테스트 계획 (데이터 레벨 회귀)

`core/services/ledger-reconciliation.integration.spec.ts` (services 디렉터리 co-located — 선행 stocktaking 스펙 배치 관례 동일. 하네스 재사용):

1. **정상**: `StockEventStore.createEvent`로 RECEIVE/MOVE 등 정상 seed → `reconcile()` `totalDriftGrains === 0`.
2. **수량 불일치**: 위 정상 상태에서 `update(stockLedgers)`로 한 grain qty를 N 어긋나게(스토어 우회) → 그 grain만 탐지, `delta === N`, `severity='MISMATCH'`.
3. **원장 행 부재**: 이벤트는 남긴 채 해당 grain의 `stock_ledgers` row 삭제 → 탐지, `ledgerQty=0`, `derivedQty≠0`.
4. **필터**: `warehouseId` 필터가 다른 창고 drift를 제외하는지.

> arch test는 소스만 보므로 이 데이터 테스트가 **별도로 필요**. `severity='CRITICAL'`(음수 derived)는 정상 경로로 재현 불가(스토어가 음수 이벤트를 막음)하므로 유닛 레벨에서 리포트 매핑 함수만 직접 검증하거나 생략.

## 8. 변경 파일 요약

**신규**
- `apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts`
- `apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.ts`
- `apps/core/src/modules/inventory/core/dto/ledger-reconciliation.dto.ts` (리포트/행 응답 DTO)
- `apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts`

**수정**
- `apps/core/src/modules/inventory/shared/services/metrics.service.ts` (Gauge + `setLedgerDrift`)
- `apps/core/src/modules/inventory/core/inventory.module.ts` (등록)

**마이그레이션**: 없음.

## 9. 검증 제약 (선행 작업과 동일)

- dev DB 부재 시 통합 스펙은 로컬 미실행 가능 — `tsc`(build) + `lint` + 기존 arch spec 통과 확인이 최소 게이트.
- DB 복구 시 통합 스펙 실행(§7) — stocktaking 작업의 ⏸ "배포 전 확인" 항목과 동일 처리.
- 엔드포인트 수동 검증: DB 있는 환경에서 `GET /inventory/ledger-reconciliation` 호출 → 정상 시 `totalDriftGrains:0` 확인, 의도적 원장 손상 후 탐지 확인.

## 10. 오픈 체크포인트 (착수 시)

1. **엔드포인트 route 접두사** — 다른 inventory 컨트롤러의 `@Controller` base path 관례에 맞춰 최종 확정(`inventory/ledger-reconciliation` 잠정).
2. **`setLedgerDrift` 게이지 리셋 시맨틱** — 정상 실행 시 이전 라벨 값 잔존 방지를 위해 `gauge.reset()` 후 set 필요 여부 확인(prom-client Gauge 라벨 동작).
3. **크론 시각** — `03:00 KST` 잠정. 다른 야간 잡(`auto-confirm-purchase-orders` `00:00`)과 시각 충돌·부하 겹침 없는지 확인.
