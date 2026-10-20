# 라인 수량 사실은 기록 위치 하나, 읽는 문 하나

## Status
Accepted (2026-10-20). 설계 스펙 `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md`, 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §5.2·§8.2 의 K6. K1([[0045-picking-custody-commands-share-one-kernel]])·K2([[0046-shipment-state-and-manifest-share-one-kernel]])의 방식을 따른다.

## Context
판매주문 라인의 «몇 개 주문됐고, 몇 개가 취소·출고·배송완료·청구됐고, 몇 개를 더 취소·반품할 수 있나»를 아는 곳이 여러 벌이고 벌마다 기준이 다르다
(출고 판정 7곳 이상, 배송완료 6, 진행 단계 6, 청구 수량 6, 취소 수량 파서 셋). 취소 수량만 봐도 `metadata.cancelledLines` 를 읽는 파서 세 벌의 scope 필터가
서로 다르고(리더만 `full` 포함), V1 전체취소는 `cancelledLines` 를 아예 적지 않는다. K7(취소)·K8(환불·반품)이 이 숫자 위에 서므로 판매주문 줄기의 바닥이다.

사용자가 말한 이유는 막힌 버그가 아니라 구조 다지기다. 같은 이음새에서 나온 결함(반품 환불이 같은 라인의 마지막 줄만 셈, 교환 가드가 «FO completed = 배송완료»로 봄,
묶음 라인의 단위 혼용 등)은 따로 고치지 않고 소비자를 커널로 옮기며 고친다.

## Decision
**사실마다 기록하는 곳은 하나, 읽는 문도 하나다. 기록하는 «함수»는 그 사실을 만드는 모듈에 남는다**(출고=dispatch, 배송=추적, 취소=판매주문 취소, 청구=반품·교환).
K6 이 정하는 건 «어디에 기록하나»이고 «누가 기록하나»는 바꾸지 않는다. 커널에는 업무 판단(«이 취소를 허용하나», «얼마를 환불하나»)을 넣지 않는다.

이 PR(K6 PR 1)이 만든 것은 취소 쪽 기록이다.

1. **테이블 `sales_order_cancellation_lines`.** 취소 행(`sales_order_cancellations`) × 판매 라인 × 수량 × `shipment_phase`(`before_shipment` / `after_shipment`).
   `metadata.cancelledLines` JSON 을 대체하는 하나뿐인 기록이다. V1 전체취소도 라인 행을 적는다. 갈래는 수요를 줄인 취소(출고 전)와 이미 나간 수량의 취소
   (출고 후 — 돈은 돌려줬고 물건은 고객에게 있다)를 가른다. 마이그레이션은 additive 이며 `migrate → deploy` 다.
2. **쓰는 문 `recordSalesOrderCancellation`**(`apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts`). 취소 행과 라인 행을 같은 트랜잭션의
   한 문으로 쓴다. 판매주문 취소의 세 쓰기 지점(V1 전체·부분, V2)이 모두 이 함수를 지난다.
3. **순수 규칙 `deriveCancellationLines`**(`cancellation-lines.ts`). 갈래 규칙은 **구성품 하나라도 이미 나간 판매 단위는 `after_shipment`** 다. 세트의 일부만 출고돼도
   그 단위는 되돌릴 수 없는 쪽으로 센다. 백필과 쓰기 문이 같은 함수를 쓰므로 규칙이 두 벌이 되지 않는다.
4. **가드 `cancellation-write.guard.spec.ts`.** `sales_order_cancellation_lines` 의 쓰기가 `recordSalesOrderCancellation` 밖에 있거나, 취소 행 기록이 한 문 밖에서
   이뤄지면 빨갛다(K1·K2 가드와 같은 «주인 말고는 아무도 직접 쓰지 않는다» 꼴).
5. **백필 `scripts/ops/k6-backfill-cancellation-lines.ts`.** 옛 취소 행을 주문별 시간순으로 재생해 라인 행을 만든다(옛 `cancelledLines` 와 V1 전체취소 역산).
   옛 규칙과 교차 확인해 어긋나면 그 주문은 통째로 `ambiguous` 로 보고하고 쓰지 않는다(보고는 주문당 한 건이지만 그 주문의 취소는 전부 행이 없는 채 남는다). 조회 모드가 기본이고 `--apply` 로만 쓴다. `--verify`(읽기 전용)는 취소가 전부 라인 행을 가진 주문마다 `metadata`/`effects` 로 다시 도출해 저장된 행과 (취소, 라인, 갈래, 수량) 집합을 비교하고 어긋난 주문을 찍는다(기대 0). 대조용 SQL 은 따로 두지 않는다.

**대체되는 것:** `metadata.cancelledLines` 를 읽는 파서 세 벌(`loadPriorPartialCancellationContext`, `cancelledQuantitySql`, `LineCompositionReader` 의 취소 합).
이 PR 은 기록만 더한다(이중 기록). 파서는 아직 살아 있고 PR 6 에서 삭제한다.

**이후 PR(제안, 정본은 스펙 §9):**
- PR 2 — 읽는 문(`LineQuantityReader` + 같은 정의의 SQL 조각)과 일치 spec, 취소·출고 소비자 전환.
- PR 3 — 청구(반품·교환) 게이트·환불 수량을 한 공식 `claimable` 로.
- PR 4 — 운영자 «미처리 취소»(admin-web 버튼과 `POST /shipments/:id/cancellations`), FO 취소(`POST /fulfillments/:id/cancel`), 수동 배송완료
  (`POST /fulfillments/:id/deliver`) 제거. 셋 다 판매주문 기록 없이 상태만 바꾸거나 배송 사실을 추적 밖에서 만들어 «기록 위치 하나»와 충돌한다.
- PR 6 — contract: `metadata.cancelledLines` 쓰기 중단, 옛 파서 삭제, 옛 파서 이름이 되살아나면 빨간 가드. PR 1 의 백필이 라이브에서 끝나고 한 번 이상 배포된 뒤
  (ADR-0005 §5, `deploy → migrate`).

## Why
- 사실의 정의가 한 곳이면 소비자를 하나씩 옮겨도 서로 갈라지지 않는다. 기록이 먼저 하나가 되어야 읽는 문이 «어느 쪽이 맞나» 규칙을 영구히 들고 가지 않는다(사용자가 거절한 안).
- 갈래를 기록 시점의 행으로 남기면 «취소가 출고 전이었나»를 나중에 FO/FOI 수량에서 역산하지 않아도 된다. FO/FOI(`shippedQty`·`qty`)로 역산하면 출고가 진행된 뒤에는 답이 바뀐다.
- 쓰는 함수를 커널로 끌어오지 않아 커널이 god object 가 되지 않는다.

## Consequences
- 취소 한 건이 라인 행 N개를 같은 트랜잭션에 쓴다. 쓰기 지점이 늘어도 가드 수는 늘지 않는다.
- 이 PR 만으로는 읽는 쪽이 바뀌지 않는다(동작 변경 없음). 옛 `cancelledLines` 와 새 라인 행이 공존하는 동안 둘이 어긋나면 새 행이 틀린 것이다 —
  `--verify` 로 배포 후 확인한다.
- **PR 2 착수의 차단 조건:** 라인 행이 없는 취소 수(게이트 SQL)가 백필 러너가 찍는 (a) ambiguous 주문에 속한 취소 수 + (b) 라인 0개로 도출된 취소 수의 합과 다르면 읽는 문을 만들지 않는다. 그 합만큼은 사람이 판단한 예외로 남는다.
- 백필이 모호하다고 본 주문은 라인 행이 없다. 사람이 목록을 보고 결정한다.
- 가드는 소스 텍스트를 정규식으로 훑으므로 우회가 가능하다. 실수를 잡는 그물이지 방어선이 아니다.
