# 창고간 이동 무손실화 설계 (P0-1 / W1)

> 출처: `docs/logistics-backend-hardening-2026-07.md` P0-1(창고간 이동이 `toState:null` MOVE 로 출발지만 차감 → 영구 소실) · W1(안전한 창고간 이동 엔드포인트) · WS-B 작업 6.
> 승인: 2026-07-10 (브레인스토밍 세션).

## 1. 문제

창고간 재고 이동에 **두 경로가 병존**한다.

**Path A — 손실 경로 (`movement` 모듈).** `POST /movement/inter-warehouse`(`MovementService.createInterWarehouseTransfer`, `movement.service.ts:174-253`)가 단일 이벤트를 `fromState:'ON_HAND' → toState:null`(`:231-232`)로 append — **출발지 ON_HAND 만 차감하고 어디에도 입고를 기록하지 않는다.** 짝인 `POST /movement/jobs/:id/complete`(`completeInterWarehouseMovement`, `:259-305`)는 receive 이벤트 없이 destination 인바운드 플랜의 `expectedDate` 만 갱신한다. ad-hoc 이동 100개 → 출발 창고 −100, +100 은 어디에도 없음 = 영구 소실(P0-1).

**Path B — 안전 경로 (`core/transfer`).** `POST /inventory/transfers`(생성) + `PATCH /:id/execute`(실행)가 `StockEventService.transferBetweenWarehouses`(`stock-event.service.ts:142-196`)를 호출 — `transferShip`(ON_HAND→IN_TRANSFER) + `transferReceive`(IN_TRANSFER→ON_HAND)를 **한 트랜잭션에서** 실행해 **수량 보존이 정확**하다.

### 착수 재확인(2026-07-10) — 호출자 전수 감사

프론트(admin-web)·백엔드·타 앱 전 경로를 훑은 결과, 상황이 감사 보고("재배선 필요")와 다르다:

| 경로 | 라우트 | 모노레포 호출자 | 판정 |
|---|---|---|---|
| Path A | `POST /movement/inter-warehouse` | **0** (유닛 스펙만) | 노출됐으나 미호출 — **라이브 지뢰** |
| Path A | `POST /movement/jobs/:id/complete` | **0** (전무) | **완전 dead** |
| Path B | `POST /inventory/transfers`·`PATCH /:id/execute`·`move-within-warehouse` | **admin-web transfers UI 라이브** | 안전 경로, 이미 배선 |

- Path A 의 라이브 라우트는 `POST /movement/move`(`moveImmediately`, admin-web 배치 이동 dialog)와 `GET /movement/history`·`GET /movement/jobs/:id` 뿐 — **전부 동일창고(intra) 경로이고 `StockEventStore` 경유로 정상**.
- W1 의 "안전한 엔드포인트 부재"는 **틀린 전제** — `inventory/transfers` 가 그 자리를 이미 채우고 admin-web 이 그것을 쓴다.

따라서 P0-1 해소는 **재배선이 아니라 은퇴**다. 감사가 나열한 "재배선 시 간극"(도착 로케이션 결정 규칙, DTO `toLocationId` 부재, `withIdempotency`×transferShip/Receive 상호작용, `movementJobs.warehouseId` 의미 차이)은 전부 *재배선했을 때만* 발생하며, 은퇴하면 소멸한다.

### 부수 발견 — 미완성 2단계 인지송(범위 밖, 문서화 대상)

`movement.service` 주석("중국 창고 → 부천 창고")과 반쯤 지어진 `planType='destination'` 인바운드 플랜 메커니즘(`purchase-order.service.ts:313`이 외화 PO `requiresTransfer` 시 `expectedDate:null` 로 생성)은 **의도된 다일(multi-day) in-transit 플로**의 흔적이다: source 창고에서 받고 → 이송 → 도착 시 destination 플랜 활성화. 이 루프의 마지막 고리가 죽은 `completeInterWarehouseMovement` 였다. 어느 경로도 이를 구현하지 않는다 — Path A 는 소실, Path B 는 ship+receive 를 한 tx 로 압축(지속 IN_TRANSFER 없음). **이는 P0-1(소실) 과 별개의 미구현 업무 흐름이며 본 작업 범위 밖**이다(§6-2).

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| Path A 처분 | **하드 삭제** | 모노레포 호출자 0(내부 admin API). Gone 스텁도 검토했으나 미호출 내부 라우트라 순수 삭제가 가장 깔끔 — 작업 4·5 dead 청소와 동일 성격 |
| 2단계 in-transit 플로 | **이연 + 문서화** | 진짜 in-transit(지속 IN_TRANSFER·도착 시 receive·destination 플랜 활성화)은 상태기계·receive API·도착 로케이션 규칙이 필요한 별도 기능. P0-1 무손실화 범위를 크게 벗어남 |
| Path B 견고화 | **경량 하드닝** | 유일 경로가 된 이상 이중출고 구멍은 닫되, 요청키 완전 멱등화(작업 3 패턴, DTO+admin-web 훅 수정)까지는 이번 범위 밖 |
| 스키마 | **무변경** | `movement_jobs`/`movement_job_lines`/`movement_work_logs` 테이블 존치 — 작업 4 의 `sku_location_movements` 처럼 코드만 제거, destructive DROP 회피(ADR-0005 §5) |

## 3. Part 1 — Path A 하드 삭제

`movement/` 모듈에서 inter-warehouse 자산만 절제하고 intra-warehouse batch 는 존치한다.

### 삭제

| 대상 | 위치 |
|---|---|
| `MovementService.createInterWarehouseTransfer` | `movement/services/movement.service.ts:174-253` |
| `MovementService.completeInterWarehouseMovement` | `movement.service.ts:259-305` |
| `MovementController` `POST inter-warehouse` 핸들러 | `movement/controllers/movement.controller.ts:14-19` |
| `MovementController` `POST jobs/:id/complete` 핸들러 | `movement.controller.ts:21-27` |
| `InterWarehouseTransferDto` (파일 전체) | `movement/dto/inter-warehouse-transfer.dto.ts` |
| `createInterWarehouseTransfer` describe 블록 | `movement/services/movement.service.idempotency.spec.ts` (해당 케이스만) |

### 존치

| 대상 | 이유 |
|---|---|
| `moveImmediately` + `POST /movement/move` | admin-web `move-dialog` 라이브, 동일창고 배치 이동(정상 경로) |
| `getJobById`·`getMovementHistory` + GET 라우트 | admin-web 조회 라이브 |
| `StockEventStore`·`InventoryIdempotencyService` 주입 | `moveImmediately` 가 계속 사용 |

### 부수 정리

- 삭제 후 top-level `inArray` import(`movement.service.ts:9`) 제거 — `createInterWarehouseTransfer`(`:183`)만 top-level `inArray` 를 쓴다. `moveImmediately` 는 콜백 인자 `inArray`(`:33`)를 쓰고 `and`·`eq` 는 계속 사용하므로, 삭제 대상은 `inArray` 하나. tsc/lint 로 확정.
- **작업 3 의 흔적 제거**: 작업 3(입고/이동 멱등화)이 `movement.inter-warehouse` 엔드포인트를 `withIdempotency` 로 래핑하고 `InterWarehouseTransferDto.idempotencyKey` 를 required 로 추가했다(당시 "재배선 후에도 살아남는다" 가정). 은퇴로 방향이 바뀌었으므로 래퍼 호출·DTO 필드가 메서드/파일과 함께 삭제된다. `movement.move`(`moveImmediately`) 의 멱등화는 무관하게 존치.

### 의미 divergence 자동 해소

`movementJobs.warehouseId` 를 `toWarehouseId` 로 쓰는 유일 지점이 `createInterWarehouseTransfer`(`:215`)였다. 삭제 후 이 컬럼을 쓰는 곳은 `moveImmediately`(단일 창고)와 `TransferService`(출발 창고, `transfer.service.ts:69`)뿐 — **`warehouseId` 가 일관되게 "출발/소유 창고" 의미로 수렴**한다. 별도 마이그레이션·백필 불필요.

## 4. Part 2 — Path B 경량 하드닝 (이중출고 봉인)

`TransferService.executeTransferJob`(`transfer.service.ts:113-248`)에 재실행 방어를 넣는다. 현재 라인 루프(`:159`)는 `line.eventId` 를 검사하지 않아, 이미 실행된 잡을 재-PATCH 하면 `transferBetweenWarehouses` 가 다시 호출돼 **이중출고(over-count)** 가 난다(출발지 재고 충분할 때). `transferBetweenWarehouses` 는 이벤트 레벨 `idempotencyKey` 를 넘기지 않으므로 이벤트 dedup 방어도 없다.

### 두 겹 가드

1. **동시성 (FOR UPDATE):** `executeTransferJob` 진입 시 대상 `movementJob` **헤더 row** 를 `SELECT … FOR UPDATE` 로 잠근다 — 같은 `jobId` 로 들어온 동시 PATCH 두 건이 같은 job row 락을 놓고 직렬화되어, 각각 `eventId=null` 을 읽고 둘 다 실행하는 race 를 차단. (라인이 아닌 헤더를 잠그는 이유: "이 잡을 실행한다"의 직렬화 지점이 잡 단위이고, 라인 집합 전체를 한 번에 봉인)
2. **재실행 (eventId skip):** 라인 루프에서 `eventId` 가 이미 설정된 라인은 skip. 전 라인이 기실행이면 재-ship 없이 완료 결과를 반환(멱등 no-op). `executeTransferJob` 이 단일 `dbService.run` tx 라 부분실행은 롤백되어 불가하므로, 가드는 "기완료 잡 재-PATCH" 케이스를 덮는다.

### 범위 밖(의도적 제외)

- **요청키 완전 멱등화**: `execute` 를 `withIdempotency` 로 감싸는 것(DTO `idempotencyKey` + admin-web `useIdempotentMutation` 훅). 결정대로 이번 범위 밖 — FOR UPDATE + eventId skip 으로 이중출고는 이미 봉인.
- **event-level idempotencyKey 파생 주입** (`moveImmediately` 식 `:i` 접미): 위 두 가드로 충분, 심층 방어는 후속.

## 5. Part 3 — 테스트 (2-tier)

dev DB 부재로 통합 테스트 런타임을 지금 돌릴 수 없다(작업 1·2·3 과 동일 제약). 단위는 지금 GREEN, 통합은 ⏸.

### Unit (DB 불요 — 지금 GREEN)

Path B 의 **첫 테스트**. `StockEventService`/`commandService` 모킹:
- **재실행 가드**: `eventId` 설정된 라인 → `transferBetweenWarehouses` 미호출(no-op) 검증.
- **오케스트레이션**: 라인당 ship+receive **양다리**가 동일 수량으로 호출 — 반쪽 이송(출발만/도착만) 불가 검증.

### Integration (dev DB 복구 시 ⏸)

- **수량 보존**: inter-warehouse execute 후 원장이 origin −N / dest +N, 총량 불변, IN_TRANSFER 잔량 0.
- **동시성**: 동시 execute 2건 → 한 건만 ship, 이중출고 없음(FOR UPDATE 직렬화).

### 회귀

`inventory-write-boundary.arch.spec.ts`(작업 1 직접-INSERT 금지 경계) PASS 유지. movement 단위 spec 의 존치 케이스(`moveImmediately`) PASS 유지.

## 6. Part 4 — 문서화

### 6-1. 현황판 갱신

`logistics-backend-hardening-2026-07.md`:
- P0-1 · W1 → 🟩, 완료 근거 링크.
- §5 WS-B "작업 6" 완료 블록 추가(작업 4·5 블록 형식).

### 6-2. 신규 W-항목 (미완성 업무 흐름)

> **외화 PO 크로스보더 인바운드 미완성**: source 플랜 → 창고간 이송 → destination 플랜 활성화(도착 시 receive)의 2단계 in-transit 플로가 미구현. 삭제한 `completeInterWarehouseMovement` 가 닫으려던 루프다. Path A(소실)·Path B(즉시 atomic) 어느 쪽도 지속 IN_TRANSFER 를 모델링하지 않음.

부수 관찰(별도 추적): `purchase-order.service.ts:313` 이 외화 PO 마다 `planType='destination'`(`expectedDate:null`) 플랜을 만들지만 활성화 경로가 없어, 해당 플랜 아이템이 `pending` 으로 잔존하며 `stock_summary` 뷰의 `transit_out`(출발지 available 차감) / `inbound_pending`(도착지 projected 증가)에 영구 반영되는 데이터 냄새 — **기존 조건이며 본 작업이 악화시키지 않음**(complete 는 이미 dead). W-항목에 명기.

## 7. 검증 게이트

- `nest build core`(tsc/webpack) exit 0.
- eslint — 변경 파일 **신규** error 0 (repo 전역 lint debt 는 무관).
- `inventory-write-boundary.arch.spec.ts` PASS.
- 삭제 심볼(`createInterWarehouseTransfer`·`completeInterWarehouseMovement`·`InterWarehouseTransferDto`) 저장소 전역 참조 0.
- Path B unit GREEN. 통합 ⏸(작업 1·2·3 항목과 동일 취급).
- 스키마 무변경이라 dev DB 의존 마이그레이션 ⏸ 없음.

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| 외부(비-모노레포) 호출자가 `POST /movement/inter-warehouse` 를 침 | 하드 삭제 결정대로 진행. 모노레포 전 앱 grep 0 확인됨. 외부는 코드로 증명 불가하나 내부 admin API 성격상 수용 |
| 구현 중 `complete` 의 숨은 호출자 발견 | 이미 전무 확인(FE·BE·타 앱·테스트). 구현 시 삭제 전 grep 재확인 |
| Path B `FOR UPDATE` 가 `moveWithinWarehouse`(내부적으로 create+execute 동일 tx)와 self-lock | 신규 잡이라 경합 대상 없음(방금 INSERT 한 row) — 구현 시 확인 |
| 통합 테스트 미실행분 잠복 | 작업 1·2·3 과 동일하게 ⏸ 명기, dev DB 복구 시 일괄 실행 |
