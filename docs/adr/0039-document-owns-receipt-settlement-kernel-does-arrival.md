# 문서가 수령 정산을 소유하고, 현장 입고는 공통 커널이 한다

## Status

Accepted (2026-09-14). ADR-0032 결정 1·4와
`docs/superpowers/specs/2026-08-27-purchase-order-closure-derivation-design.md`의
`items → plan → PO` 파생 사슬을 대체한다. ADR-0032 결정 2·3은 유지한다.

## Context

입고계획 헤더와 품목은 발주와 실발주 라인의 수량·날짜·상태를 복제했다. 그 역류 파생은 다음 결함과
2026년 8월의 ABBA 교착을 만들었다.

- 분할 발주의 첫 라인을 전량 입고해 계획이 닫힌 뒤 두 번째 라인을 실행하면, 닫힌 계획이 재사용되어 입고 대기 목록에서 사라졌다.
- 일부를 입고한 뒤 남은 라인을 `unavailable`로 끝내면 발주가 `confirmed`에 머물렀다.
- 당일 수령 취소가 품목만 복원하고 닫힌 계획과 `received` 발주를 되돌리지 않았다.

뿌리는 `items → plan → PO`로 거슬러 올라가는 정산이었다. 입고계획 헤더는 발주의 창고·이동 여부와
품목 상태를 복제했고, 입고계획 품목은 실발주 라인의 수량·예정일을 복제했다. 발주가 자기 정산을
소유하고 현장 도착 작업만 공통 커널에 맡기면 이 역방향 경계와 사본을 함께 없앨 수 있다.

## Decision

| # | 결정 | 기각한 대안 |
|---|---|---|
| D1 | **입고계획 헤더와 품목을 모두 없앤다. 발주 라인이 곧 입고예정이다** | 헤더를 무시만 한다(마이그 0) — 헤더를 남기면 다음 사람이 다시 쓴다 · 헤더만 제거하고 품목은 입고 모듈에 둔다 — 수량·날짜 사본이 남는다 |
| D2 | **발주가 자기 수령(정산)을 소유한다** | 입고 모듈이 전부 소유 — 역류 경계가 결함 ㄱ·ㄴ·ㄷ 과 8월 교착을 낸 자리다 |
| D3 | **현장 입고 작업은 입고 모듈의 공통 커널이 한다.** 문서는 커널을 호출한다 | 문서마다 현장 작업을 복제(이동 지시서 모양) — 이미 이동 지시서 수령에 적치 대기·당일 취소·작업 로그가 없다(`ReceiveTransferInput.toLocationId`) |
| D4 | **단독 입고예정(발주 없는 입고예정)은 만들지 않는다.** 발주 없는 입고는 간편입고로 충분하다 | `po_id` nullable 로 열어두기 — 운영상 이중 계상·영구 미종결 위험만 생긴다 |
| D5 | **입고예정일은 발주 라인에 nullable 로 둔다. 정확도 향상은 후속 과제** | — |
| D6 | **셀메이트 입고예정 CSV import 를 삭제한다.** 날짜는 core 발주 입력으로만 들어온다 | import 를 새 구조로 옮기기 — 급하지 않고, 발주의 정본 결정(리테일팀 도입) 전에 셀메이트 경유 구조를 새 모델에 다시 새기는 셈 |
| D7 | **초과 수령은 거절한다.** 넘는 분량은 간편입고 | 허용 — 실무에서 초과 발송을 본 적이 없고, 거절하면 `received_qty ≤ ordered_qty` 를 DB 가 잠근다 |
| D8 | **기존 간편·전수·개별입고도 커널로 옮긴다** | 옮기지 않기 — 커널이 다섯 번째 사본이 된다 |
| D9 | **라인의 입고 진행은 enum 값이 아니라 카운터에서 파생한다** (§5) | `po_line_status` 에 `received`·`short_closed` 추가 — §5 참조 |
| D10 | **`received` 에서 나가는 길은 당일 수령 취소 하나다.** 라인 수정·실행·불가·발주 취소·예정일 수정은 `received`·`cancelled` 에서 막는다 | `received` 발주에 요청 라인을 넣어 `created` 로 되돌리기 — 종결된 발주에 요청 라인을 되살리는 셈(현행 드로어 주석의 결정) |
| D11 | **`isTerminal` 을 지우고 술어 둘로 나눈다** — 편집 관문 `acceptsChanges` · 파생 동결 `isDerivationFrozen` (§5.3) | `isTerminal` 의 뜻만 `cancelled` 로 좁히기 — 옛 뜻으로 쓴 호출이 컴파일을 통과한 채 조용히 틀어진다 |

## Consequences

- 잠금 순서는 `purchase_orders` 행 `FOR UPDATE` → `purchase_order_lines` 행 `FOR UPDATE`(`sku_id` 오름차순) → 커널의 회차 라인 `FOR UPDATE` · 회차 헤더 `FOR NO KEY UPDATE`다. 커널은 발주 행·라인을 절대 잠그지 않고, 회차 헤더에 `FOR UPDATE`를 걸지 않는다. 후자는 적치 작업 로그의 FK `KEY SHARE`와 교착한다.
- 커널의 public 메서드는 마지막 인자로 필수 `tx`를 받는다.
- 회차 라인의 `source` 가드는 커널 한 곳에서 적용한다.
- 발주 `received`는 **더 받을 것이 없다**는 뜻이다. 모든 실발주 라인이 전량 입고됐거나 잔량 포기됐다.
- 옛 `inbound_plans`·`inbound_plan_items` 테이블과 관련 컬럼은 PR-C에서 삭제한다.
- 이동 지시서를 공통 커널에 편입하는 일은 이 결정의 범위 밖이다.

## 2026-09-16 입고 대기 보호 보완

- `StockEventStore.applyProjection`은 stock availability 잠금 아래 최종 ON_HAND 순감소를 검사한다. posted 회차의 시스템 원위치별 `quantity - putawayFromOriginQty - returnedQty - canceledQty`를 합산하고, 활성 출고 custody와 함께 보호한다. 일반 선반 직접입고와 입고 대기에 속하지 않은 자유 재고는 별도이며, 현재 원장에 맞춰 입고 누계를 줄이지 않는다.
- 적치·회송·취소는 원래 입고 잔량과 custody를 실재고가 충족하는지 먼저 검사하고, 처리할 입고 누계를 같은 트랜잭션에서 먼저 변경한 뒤 원장을 이동/역분개한다. 남은 다른 입고의 물량은 최종 가드가 계속 보호한다. 이후 원장·업무 로그·발주 정산 어느 단계가 실패해도 누계까지 모두 롤백한다. 발주가 정산을 소유하고 커널은 필수 `tx`를 받는 의존 방향은 유지한다.
- 잠금 순서는 발주 헤더 → 발주 라인 → 입고 라인 → 입고 헤더 `FOR NO KEY UPDATE`를 유지한다. 취소는 원 RECEIVE 이벤트 → stock availability 순서로 잠가 기존 역분개와 일치시킨다. 적치/회송은 입고 잠금 다음 stock을 취득한다. stock 잠금을 가진 공통 가드는 입고를 일반 SELECT로 읽으며 입고 행 잠금을 추가하지 않는다.
- 적치 대상은 같은 창고의 활성 일반 위치다. 출발 위치와 같거나 시스템 위치면 거절한다. DTO 플래그나 사유로 보호를 우회하지 않는다. 새 출고 계획과 세션 취득은 입고 대기를 제외한 자유 수량만 사용하며 경제적 예약 정의는 바꾸지 않는다.
- `capabilities.inboundWorkflowConsistency`는 보호·현재 상태 조회·영속 재확인 계약을 함께 검증한 서버에서 공개한다. 과거 확정 응답의 재생은 현재 상태를 뜻하지 않으므로, 클라이언트는 원래 키/본문/계정 범위로 미확인 작업을 대사한 뒤 현재 라인 상태를 읽는다.
- 기존 불일치는 읽기 전용 감사와 실물 대사 대상으로 남긴다. 자동 귀속/FIFO/누계 보정은 하지 않으며 운영 배포·보정·기기 인수는 별도다. 검증 범위와 한계는 [입고 일관성 인수 기록](../../native/warehouse-app/docs/inventory-accuracy-acceptance.md#2026-09-16-입고-대기-보호와-현재-상태-일관성)을 따른다.

## References

- `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md`
- PR-A: #867
- 추적 이슈: [#871](https://github.com/LCNINE/almondyoung-server/issues/871)
- PR-B: [#872](https://github.com/LCNINE/almondyoung-server/pull/872)
