# 주문 취소의 순서는 커널 하나가 소유하고, 문은 의도만 넘긴다

## Status
Accepted (2026-10-24). 설계 스펙 `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md`, 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` 의 K7. K1([[0045-picking-custody-commands-share-one-kernel]])·K2([[0046-shipment-state-and-manifest-share-one-kernel]])·
K6([[0047-line-quantity-facts-one-record-one-reader]])의 방식을 따른다. 이 문서는 K7 PR 1 이 정한 것과 그 뒤 남은 것을 적는다.

## Context
판매주문 취소는 문이 여럿이다 — 고객 셀프취소, 운영자 취소, 채널(네이버·쿠팡) 취소 통보, 채널 수량 감소, 무통장 승인 통보. 문마다
«판정 → 와우프레스(인쇄 외주) 취소 → 판매주문 확정 → 기록» 순서를 제 손으로 이었고, 순서가 문마다 조금씩 달랐다. 채널 이름(`'medusa'`·`'naver'`·`'coupang'`·`'3pl'`)
문자열로 갈래를 고르는 곳도 여럿이라, 모르는 채널이 조용히 core 갈래로 떨어졌다. 「V1/V2」라는 이름은 레거시 대 신형처럼 읽히지만 실제 구분은 상자가 있기 전/후이고 둘 다 현역이다.

## Decision
1. **취소의 순서(판정·와우프레스·확정·기록)는 커널 `OrderCancellation`(`apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts`) 하나가 소유한다.**
   문은 «누가, 어느 주문을, 무슨 이유로»라는 의도만 넘긴다. 와우프레스 취소를 트랜잭션 밖에서 먼저 부르는 것(외부 HTTP — 잠금을 쥔 채 기다리지 않는다)도 커널 안의 일이다.
2. **요청과 통보를 구분한다.** `request` 는 거절될 수 있는 요청(고객·운영자·채널 취소 요청 — 판정이 막으면 400/409)이고, `notice` 는 이미 일어난 일의 통보(채널이 취소했다,
   수량이 줄었다, 무통장 승인 결과)라 거절하지 않고 반영한다. 트랜잭션을 이미 쥔 통보는 `notice(…, tx)` 로 트랜잭션 안에서, 커밋 뒤 할 일은 `afterCommit(followUp)` 으로 따로 돌려받는다.
3. **커널은 돈을 만지지 않는다.** `WalletRefundClient` 를 import 하지 않는다(환불은 Wallet 의 일이고 방침은 K7 PR 4). 가드가 이 import 를 막는다.
4. **채널은 이름이 아니라 능력으로 읽는다.** `channel-cancellation-capability.ts` 의 표 하나가 채널별 능력(명령으로 취소할 수 있나 등)을 갖고, 이름 리터럴은 그 파일에만 있다.
   표에 없는 채널 문자열은 core 로 떨어지지 않고 `Error` 다(D8). 능력을 주문 자체에 싣는 일은 후속 이슈 #1123.
5. **가드 `order-cancellation.guard.spec.ts`.** 판매주문 취소 적용·취소 계획·채널 취소 확정·와우프레스 취소 문·`print_orders` 직접 UPDATE 를 부르는 파일을 허용 목록으로 못박고,
   커널 디렉터리의 Wallet 참조와 취소 경로의 채널 이름 리터럴을 금지한다. 허용 목록은 줄어드는 방향으로만 바뀐다.

이름: 상자 유무 판정 `hasBoxedFulfillment`, 갈래 `cancelBeforeBoxingFull`·`cancelBeforeBoxingPartial`·`cancelAfterBoxing`. «shipment» 는 쓰지 않는다 —
K6 의 `shipmentPhase` 는 «출고 전/후»라 뜻이 겹친다.

동작 변경은 없다(같은 입력이 같은 상태·문구·행). 예외는 4번의 D8 하나이고 `sales_channel` enum 네 값이 모두 표에 있어 라이브 영향은 0 이다.

## 현재 상태
PR 1 뒤에도 허용 목록에 남는 것과 그것을 지우는 PR:
- **N1.** core 가 돈을 쥔 주문(`3pl`)의 관리자 취소는 `StoreSalesOrdersService.adminCancelRequest` 에 남는다. 부분취소와 환불 검토 기록(`manual_pending`)을 한 트랜잭션에 묶는데,
  커널은 와우프레스를 트랜잭션 밖에서 먼저 부르므로 지금 모양으로는 못 들어온다. PR 4(환불 방침)가 그 기록을 커널의 «나중에 결정»으로 옮기며 지운다. 라이브 0건.
- **N2.** 수신 트랜잭션을 가진 채널 취소 컨슈머(`OrderEventsConsumer.handleOrderCancelled`)는 커널을 두 번 부른다 — `notice(…, tx)` 와 커밋 뒤 `afterCommit`.
  이벤트 중복 기록과 취소가 한 트랜잭션이어야 해서다. PR 2 가 와우프레스 순서를 다시 볼 때 두 번째 호출을 없앨 수 있는지 판단한다.
- **N3.** 채널 수량 감소의 «안 보낸 인쇄 붙잡기»(`print_orders` 직접 UPDATE)는 `ChannelOrderChangeManager` 에 남는다. 줄 전체 제거·셀메이트 출고처럼 커널을 부르지 않는 갈래에서도 붙잡기 때문이다. PR 2(D7)가 옮긴다.
- **N4.** 무통장 승인은 «와우프레스 record 먼저, 확정 나중» 순서 그대로다. PR 2(D6)가 바꾼다.

## Consequences
- 새 취소 문은 커널에 의도만 넘기면 된다. 순서를 직접 이으면 가드가 빨갛다.
- 와우프레스·환불 순서를 바꾸는 후속 PR(2·4)은 커널 한 곳과 허용 목록 줄이기로 끝난다.
- 능력 표는 channel-adapter 표와 «명령으로 취소» 하나만 대조한다(`automatedCancellation` ↔ `cancel === 'command'`). 나머지 능력의 대조는 #1123.
