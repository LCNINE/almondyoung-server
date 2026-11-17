# 컷오버: 위치가 하나인 SKU 의 재고를 입고기본존에서 선반 로케이션으로 옮긴다 — 설계

- 이슈: #1236 (상위 지도 #1233 · 축 1 로케이션)
- 날짜: 2026-11-17
- 짝: #1243 (셀메이트 시기 잔재 닫기) — 별도 PR, 별도 설계 문서

## 1. 왜

라이브 판매 창고의 재고는 전량이 입고기본존(시스템 로케이션, `system_role = 'inbound_default'`) 한 곳에 있다. #1235 가 셀메이트 선반 위치 텍스트로 선반 로케이션(standard)을 만들었지만 재고는 아직 거기 없다. 원장이 실제 선반을 가리켜야 피킹 안내(`FifoLocationStrategy`, 원장 행 기준)와 송장 위치 칸이 원장에서 나온다.

컷오버 때 실사는 하지 않는다(사용자 결정 — 셀메이트를 믿는다). 그래서 **위치를 하나로 아는 SKU 만** 옮기고, 나머지는 입고기본존에 남겨 컷오버 뒤 실사 대상으로 넘긴다. 남은 SKU 의 송장은 지금 규칙(`label-items.ts` — 배정 로케이션이 시스템 로케이션이면 셀메이트 위치 텍스트)대로 찍힌다.

## 2. 목표 · 비목표 · 반목표

**목표**
- 위치가 하나인 SKU 의 입고기본존 ON_HAND 가 그 선반 로케이션으로 MOVE 되어 있고, 피킹 안내가 그 로케이션을 가리킨다.
- 옮기지 않은 SKU 목록(사유 포함)이 파일로 남는다.
- 판정 스크립트(`scripts/ops/cutover-preflight`)가 같은 판정으로 «옮길 것 / 남길 것»을 센다.

**비목표**
- 위치가 둘 이상인 SKU 의 분할, 로케이션별 실사, 이상치 SKU 정리 — 컷오버 뒤.
- 예외 위치 텍스트(#1235 의 `exception`)를 사람이 정한 코드로 묶기.
- 셀메이트 재고 백업 CSV 대조(§4 의 B) — 아래 «나중» 참고.

**반목표 (돌아가도 실패인 것)**
- 원장을 직접 UPDATE 한다. 반드시 `stock_events` MOVE 이벤트로 간다.
- 같은 재고를 두 번 옮기거나, 재실행이 엉뚱한 재고(T 이후 앱 입고분)를 쓸어 간다.
- 적치 대기 중인 입고분이나 피킹 배정이 걸린 재고를 옮겨 진행 중 작업을 깬다.
- 창고·거래처 이름이 섞인 위치 원문이 레포에 커밋된다(공개 레포).

## 3. 제약

- 실행 시점: **T 의 마지막 `sync-stock`·`load-shelf-positions` 직후**(당일 순서 2). sync 가 증가분을 입고기본존에 넣으므로 전날 옮기면 다시 갈린다. `sku_shelf_positions` 도 그 직전 적재가 최신이어야 한다.
- `sku_shelf_positions` 는 SKU 당 한 행이고, 적재 스크립트는 같은 옵션이 두 번 나오면 **마지막 값으로 덮어쓴다.** 그래서 DB 만으로 «위치가 여럿»을 알 수 있는 건 텍스트 자체에 여럿이 적힌 경우뿐이다.
- `MovementService.moveImmediately` 가 MOVE 의 도메인 명령이다. 멱등키 재사용 시 본문이 다르면 `ConflictError` 를 던진다.
- `StockEventStore.createEvent` 는 `BatchControlledStockGuard.assertRemovalAllowed` 로 **적치 대기 입고분(`inboundPendingQty`)·배치 세션 통제분**을 출발지에서 빼지 못하게 막는다(`INBOUND_ORIGIN_STOCK_PROTECTED` / `BATCH_CONTROLLED_STOCK`).
- core 는 테넌트마다 DB 가 따로다. 셀메이트 데이터가 있는 건 테넌트 1 뿐이므로 스크립트는 `DATABASE_URL` 하나(그 core DB)를 대상으로 한다.

## 4. 접근

«위치가 하나»의 판정을 무엇으로 할지가 핵심이었다.

- **A. DB 텍스트만 본다 — 채택(2026-11-17 사용자 결정).** `sku_shelf_positions.position_code` 를 #1235 와 같은 함수(`readShelfCode`)로 읽어, 로케이션 코드 **정확히 하나**로 읽히고 그 코드의 활성 standard 로케이션이 같은 창고에 있으면 «하나». 한 칸에 위치를 여럿 적은 텍스트·창고 이름 등은 `exception` 이라 자연히 남는다. 한계: 셀메이트에 하나만 적혔는데 실물이 두 곳인 SKU 는 못 거른다 → 피킹 때 결품 신고로 드러나고 실사에서 바로잡는다. «셀메이트를 믿는다» 결정과 맞는다.
- **B. A + T 당일 셀메이트 재고 백업 CSV 대조.** 같은 옵션이 여러 행에 다른 위치로 나오거나, 바코드로 같은 SKU 에 짝지어진 옵션 둘의 위치가 다르면 남긴다. 덮어쓰기 때문에 DB 에선 안 보이는 경우다. **보류** — 그런 경우가 있는지 아직 모른다(2026-11-17 받은 상품목록 파일엔 위치·옵션·바코드 열이 없었다).
- **C. A + 현장이 주는 «여러 곳에 있는 SKU» 목록.** 가장 정확하지만 사람이 목록을 만들어야 한다. 기각.

**나중(B 를 켤지):** T 전에 셀메이트 재고 백업을 한 번 받아 «같은 옵션 여러 행»·«바코드 같은데 위치 다름»을 센다. 둘 다 0 이면 A 그대로. 0 이 아니면 스크립트에 `--csv <재고 백업>` 대조를 더한다(남길 SKU 만 늘리는 필터라 A 의 구조를 안 바꾼다). 늦어도 T 당일 1번 단계에서 받는 파일로 dry-run 직전에 센다.

## 5. 설계

### 5.1 판정 — 순수 함수 (스크립트·판정 스크립트 공유)

`readShelfCode` 옆(또는 `scripts/sellmate/` 의 import 없는 파일)에 순수 함수 하나를 둔다. 입력: SKU 의 위치 텍스트(없을 수 있음), 그 창고의 활성 standard 로케이션 코드 집합. 출력:

| 결과 | 조건 |
|---|---|
| `move` (목적 코드) | 텍스트가 `exact`·`fixed`·`custom-bin` 으로 읽히고 고쳐 읽은 코드의 로케이션이 있다 |
| `keep: no-position` | `sku_shelf_positions` 행이 없다 |
| `keep: unreadable` | `exception` (여러 위치 텍스트 포함) |
| `keep: no-location` | 읽혔지만 그 코드의 활성 standard 로케이션이 창고에 없다 |

`fixed`(`CC-4-1` → `CC-04-01` 등)는 #1235 가 그 고친 코드로 로케이션을 만들었으므로 `move` 다.

### 5.2 스크립트 `scripts/sellmate/move-stock-to-shelf.ts`

- 기본 dry-run, `--apply` 로 적용. `DATABASE_URL` 필수.
- 대상: 판매 창고(`warehouses.is_sellable`)마다 그 창고의 `inbound_default` 로케이션에 있는 `ON_HAND qty > 0` 원장 행. SKU 마다 5.1 로 판정한다.
- `move` 인 SKU 의 옮길 수량 = 그 원장 행의 qty 중 **일반 가용분**(`BatchControlledStockGuard` 의 `generallyAvailableQty` — 적치 대기 입고분·배치 통제분 제외). 제외된 나머지는 남기고 사유 `keep: protected` 로 적는다. 일반 가용분이 0 이면 통째로 남긴다.
- 그 SKU·창고에 진행 중 피킹 배정(`picking_source_allocations`, 활성 작업 항목)이 걸려 있으면 옮기지 않는다(`keep: allocated`). T 직후라 0 이어야 정상이다.
- 적용은 SKU 하나당 `MovementService.moveImmediately` 한 번(줄 하나). 생성은 `scripts/ops/close-sellmate-csv-inbound.ts` 선례처럼 필요한 의존성만 손으로 만든다(`StockEventStore`·`InventoryIdempotencyService`·sellable 서비스·guard). actor 는 시스템 actor, memo 에 `cutover #1236`.
- **멱등:** 1차는 대상 조건 자체다 — 옮긴 SKU 는 입고기본존 잔량이 0 이라 다시 대상이 안 된다. 2차는 멱등키 `cutover-1236:<warehouseId>:<skuId>:<출발 원장 행 version>` — 중간에 죽고 다시 돌려도 같은 상태면 같은 키라 두 번 옮기지 않고, 원장이 바뀌었으면 새 키다.
- SKU 하나의 실패(409 등)는 기록하고 다음 SKU 로 간다. 끝에 실패 수가 0 이 아니면 종료 코드 1.
- 출력: 요약(옮김 SKU·수량, 사유별 남김 SKU·수량, 실패) + **남긴 SKU 목록 CSV**(SKU 코드·사유·수량·위치 텍스트). 경로는 `--out`, 기본은 `apps/core/tmp/`(커밋 안 되는 곳). 위치 원문이 들어가므로 레포에 커밋하지 않는다.
- **1회성.** T 당일 재시도만 안전하다. T 이후 앱 간편입고분은 입고기본존에 들어오므로, 며칠 뒤 다시 돌리면 그걸 쓸어 간다(적치 대기로 묶인 입고분은 guard 가 막지만, 묶이지 않은 입고분은 막지 못한다). 스크립트 머리 주석과 런북에 «T 당일만»을 적는다. 막는 장치는 두지 않는다 **(Claude 판단 — 당일 한 번 돌리는 개발자 스크립트라 장치의 값이 작다)**.

### 5.3 판정 스크립트 고치기

`scripts/ops/cutover-preflight/checks/location.ts` «로케이션 2»의 «위치가 하나인 SKU» 쿼리(`count(distinct position_code) = 1`)와 «둘 이상» 쿼리(`> 1`, 항상 0)를 5.1 함수로 바꾼다 — 행을 읽어 TS 에서 판정하고 사유별로 센다. ◆(당일 처리) 문구에 스크립트 명령을 적는다.

### 5.4 테스트

- 5.1 순수 함수: 표의 각 줄, `fixed`·`custom-bin` 이 고친 코드로 `move`, 다른 창고에만 있는 코드는 `no-location`.
- 통합 스펙(`describeIfDb` 가드): 입고기본존 재고 → MOVE 후 원장이 로케이션으로, `stock_events` 에 MOVE 1건; 재실행 0건; 적치 대기 입고분은 남김; 피킹 배정 걸린 SKU 남김. 하네스는 `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts` 의 `MovementService` 조립을 쓴다.

## 6. 운영

- 당일 순서 2: `clear-reservations` → `sync-stock` → `load-shelf-positions` 마지막 실행 → **이 스크립트 dry-run → 숫자 확인 → `--apply`** → 판정 스크립트 재실행(«로케이션 2» 초록).
- 라이브 dry-run 은 터널이 필요하다 — 사용자가 띄운다. 리허설로 T 전에 dry-run 을 한 번 돌려 사유별 숫자를 본다(쓰기 없음).
- 배포 무관(스크립트만). 남긴 SKU 목록은 컷오버 뒤 실사 입력이 된다.

## 7. 빌더에게 남긴 것

- 5.1 함수의 위치(core 쪽 import 없는 파일 vs `scripts/sellmate/`) — 판정 스크립트와 이 스크립트가 같이 import 할 수 있으면 된다.
- 배정 «활성» 판정의 정확한 조건(작업 항목 상태) — `outbound-preparation.reader.ts` 의 `notInArray(status, ['excluded','completed'])` 를 따른다.
- 출력 CSV 열 순서·요약 서식.
