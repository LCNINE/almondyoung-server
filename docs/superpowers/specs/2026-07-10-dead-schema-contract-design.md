# 죽은 스키마 자산 제거 설계 (P3-5 잔여 + P3-4 orphan enum) — 작업 8a

> 출처: `docs/logistics-backend-hardening-2026-07.md` P3-5(`outbound_task` 4테이블 잔여 DROP) · P3-4(dead enum 정리 중 orphan `event_type`) · WS-B 작업 8.
> 승인: 2026-07-10 (브레인스토밍 세션).

## 1. 범위

작업 8(P3-4/P3-5 스키마 contract) 중 **저위험 pure DROP 서브셋(작업 8a)** 만 다룬다. 두 죽은 스키마 자산 제거:

- **outbound_task 4테이블** (P3-5 잔여): `outbound_tasks` · `outbound_task_orders` · `outbound_task_items` · `outbound_task_lines`. 작업 5 에서 서비스 코드가 은퇴한 뒤 **런타임 참조 0**(admin-web 포함) — `inventory.schema.ts` 에 pgTable 정의 · relations · 타입 export 만 잔존하는 dead 자산.
- **orphan `event_type` enum** (P3-4 일부): `eventTypeEnum('event_type')`. 어느 테이블 컬럼에도 **미부착**(stock 원장은 `transition_type` 사용, `outbox_events.event_type` 은 varchar) — 완전 vestigial. `enum-values.ts` 재수출 외 참조 0, 외부 importer 0.

### 이연(범위 밖)

column-attached enum 값 제거(`fulfillment_status` reserving/labeled/inspecting/inspected/pending · `reservation_status` pending/active · `shipment_status` failed/in_transit · `transition_type` MARK_DEFECT/REWORK_GOOD)는 **작업 8b 로 이연**. 이유: drop-and-recreate recast 마이그레이션(값 가진 live row 1개라도 있으면 실패) + 리터럴 dead reader 다수(`reserving`6·`labeled`5·`inspecting`5·facade/store-sales/sales-orders, P3-1 영역과 겹침) 정리 + **dev DB live-row-0 검증** 필요. dev DB 복구 후 착수.

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 대상 | outbound_task 4테이블 + orphan `event_type` enum **만** | 데이터 리스크 0(순수 `DROP TABLE`/`DROP TYPE`, recast 없음), dead reader 정리 불요(둘 다 실질 참조 0) |
| expand-contract | **단일 PR (multi-phase 불요)** | 두 자산 모두 런타임 참조 0 → 옛 태스크가 칠 수 없음 → contract phase race 부재. "stop-using(expand)" 은 애초에 적용된 적 없음(never wired). ADR-0005 §5 의 phase 분리 취지(옛 코드가 destructive 스키마를 만나는 사고 방지)가 원천적으로 해당 없음 |
| `sku_location_movements` | **제외(존치)** | 작업 4 에서 재고이동 재도입 위해 의도적 보존 — 범위 밖. 오삭제 금지 |
| 마이그레이션 생성 | drizzle generate(오프라인) → 커밋, 적용 ⏸ | `db:generate:core` = `drizzle-kit generate`(schema↔meta diff, DB 미연결). config `url: process.env.DATABASE_URL \|\| ''` 폴백. `db:migrate` 만 DB 필요 → dev DB 복구 시 작업1~3 미적용분과 일괄 적용 |
| 값 있어도 orphan | **enum 전체 DROP** | `event_type` 은 IN/OUT/MOVE/ADJUST 등 그럴듯한 값이나 미부착 vestigial. 실제 원장 grain 은 `transition_type` 이 소유 |
| 마이그레이션 분할 | **단일 마이그레이션(테이블+enum 합침)** | 같은 저위험 dead-asset 제거, 같은 PR. 분리 이득 없음 |

## 3. 제거 표면

전부 `apps/core/src/modules/inventory/schema/inventory.schema.ts`(+ 같은 디렉토리 `enum-values.ts`).

### 3-1. orphan `event_type` enum
- `eventTypeEnum` 정의 **`:55-84`** 삭제.
- `enum-values.ts`: import 목록의 `eventTypeEnum`(`:7`) · `export const eventTypeValues`(`:61`) · `export type EventTypeEnum`(`:62`) 삭제. **외부 importer 0**(단어경계 grep 확인 — grep 에 걸린 `auditEventTypeEnum`/`pointEventTypeEnum` 은 별개 라이브 enum).

### 3-2. outbound_task 4테이블
| 요소 | 위치 |
|---|---|
| pgTable 정의 4개 | `outboundTasks`:1390 · `outboundTaskOrders`:1412 · `outboundTaskItems`:1430 · `outboundTaskLines`:1451 |
| schema 집계 export | `:2265-2268` |
| sibling back-relation (`…: many(outboundTask…)`) | `skusRelations`(:2403-2404) · `warehousesRelations`(:2493) · `locationsRelations`(:2542) · `salesOrdersRelations`(:2645) · `mergeGroupsRelations`(:2675) — **각 relations 블록 내 해당 라인만** 제거, 블록 자체·타 relation 존치 |
| 전용 relations 4개 | `:2731-2777` (outboundTasks/Orders/Items/Lines Relations) |
| relations 집계 export | `:3125-3128` |
| 타입 export | `:3299-3310` (`// Outbound Types` 섹션, Outbound Task/Order/Item/Line × Select/Insert) |

> DB FK 방향: outbound_task 테이블들은 서로(taskId cascade) + warehouses/skus/locations/salesOrders/mergeGroups 로 향하는 FK 를 **가진다**. 다른 테이블이 outbound_task 로 향하는 DB FK 는 **없다**(위 `many()` 는 ORM relations 일 뿐 DB 제약 아님). 따라서 DROP 은 외부 테이블 무영향, 상호 FK 는 CASCADE 로 해소.

## 4. 마이그레이션

1. §3 스키마/enum-values 편집.
2. `npm run db:generate:core -- --name drop-outbound-task-and-event-type`.
3. 예상 생성 SQL: outbound_task 4× `DROP TABLE … CASCADE` + `DROP TYPE "public"."event_type"`. **recast(text 캐스트→재생성) 0** — event_type 은 미부착이라 단순 DROP TYPE.
4. 생성 SQL 육안 리뷰 — **위 DROP 5개 외 변경이 섞이면 중단·조사**(다른 스키마 drift/미커밋 diff 신호). 이상 없으면 진행.
5. 커밋: `inventory.schema.ts` + `enum-values.ts` + `drizzle/<ts>_*.sql` + `drizzle/meta/` 갱신을 **한 커밋**(CLAUDE.md — 분리 시 타인 체크아웃 desync).
6. 적용(`db:migrate`) **⏸** — dev DB 복구 시 작업 1~3 미적용분과 일괄. DROP 은 row/데이터 무관 항상 성공이라 미적용 방치 리스크 낮음(recast 아님).

## 5. 검증

- `nest build core`(tsc/webpack) exit 0 — 타입 export·relations 제거로 dangling reference 0 임을 컴파일이 증명(작업 8a 완결성의 정적 게이트).
- `inventory-write-boundary.arch.spec.ts`(작업 1 경계) PASS 유지.
- 삭제 심볼(`outboundTasks`·`outboundTaskOrders`·`outboundTaskItems`·`outboundTaskLines`·`OutboundTask…` 타입·`eventTypeEnum`·`eventTypeValues`·`EventTypeEnum`) 저장소 전역 참조 0.
- eslint — 변경 파일 신규 error 0.
- 마이그레이션 적용/통합 검증 **⏸**(dev DB) — 작업 1~3 ⏸ 와 동일 취급.

## 6. 문서화

`logistics-backend-hardening-2026-07.md`:
- P3-5 → 🟩(코드부는 작업5 완료, 본 작업으로 **테이블 DROP 까지 종결**).
- P3-4 부분 갱신: orphan `event_type` enum 제거 완료, column-attached enum 값은 작업 8b(dev DB 복구 후)로 이연 명기.
- §5 WS-B 에 작업 8a 완료 블록(작업 5·6·7 형식). WS-B 잔여를 "작업 8b(column-attached enum 값, dev DB 복구 후)"로 갱신.

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| `db:generate` 가 실제로 DB 연결 요구 | config `url \|\| ''` 폴백 + `generate` 는 미연결(meta diff). 실패 시 즉시 표면화 → 그땐 작업 8a 전체를 ⏸ 로 전환하고 dev DB 대기 |
| 생성 SQL 에 예상외 drift 포함(미커밋 스키마 변경 등) | §4 리뷰 게이트 — DROP 5개 외 statement 있으면 중단·조사. 착수 전 `git status` clean 확인 |
| 미적용 DROP 마이그레이션이 나중 적용 시 실패 | `DROP TABLE`/`DROP TYPE` 은 row/데이터 무관 항상 성공(recast 아님) → live-row 검증 불요 |
| `sku_location_movements` 오삭제 | 결정표 제외 명기, §3 표면에 미포함 — 편집 대상 아님 |
| meta 스냅샷과 dev DB 비동기 | generate 는 커밋된 최신 meta 기준 diff(작업1~3 meta 반영됨), 적용은 저널 순서대로 |
| relations 라인만 지우려다 블록 구조 깨짐 | 각 sibling 블록에서 `outboundTask…: many(…)` **한 줄만** 제거, tsc 로 확정 |
