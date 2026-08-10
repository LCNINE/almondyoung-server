import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_DISPATCH_GATE, type OutboxDispatchGate, type OutboxDispatchPause } from '@app/events';
import { FULFILLMENT_V2_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';

/**
 * 정비 모드 동안 fulfillment·shipment 계열 아웃박스 행의 **발행만** 멈춘다
 * (ADR-0029 §5-1, Task 6-C-2).
 *
 * 옛 core 로컬 디스패처가 SQL 필터로 하던 일이다(`outbox-dispatcher.service.ts:83`). 적재는
 * 그대로 계속되고 선택에서만 빠지므로, 정비가 끝나면 그동안 쌓인 행이 순서대로 나간다.
 * 회수하면서 이 성질을 빠뜨리면 정비 중에 이벤트가 나가기 시작한다 — 6-C-2 에서 바뀌어도 되는
 * 것은 재시도 의미론 하나뿐이다.
 *
 * **옛 필터를 topic + event_type 접두사로 다시 표현했다.** 옛 것은 `aggregate_type` 도
 * 봤지만, 회수 후 그 컬럼은 스트림에서 파생되므로(`'fulfillment'` → `Fulfillment`) 값 자체가
 * 달라진다. 새 테이블에 실제로 생길 수 있는 행을 기준으로 같은 집합을 고른다:
 *
 * | 행 | 옛 필터 | 새 필터 |
 * |---|---|---|
 * | `ShipmentShipped`/`Delivered`/`DispatchRecalled` | topic 일치 | topic 일치 |
 * | `FulfillmentProgressed`/`Reopened` | topic 일치 | topic 일치 |
 * | v1 `Fulfillment*` | `event_type LIKE 'fulfillment%'` | 접두사 `Fulfillment` |
 * | `ORDER_CREATED`/`ORDER_MODIFIED` | 보류 안 함 | 보류 안 함 |
 * | 재고·주문취소·상품 | 보류 안 함 | 보류 안 함 |
 */
@Injectable()
export class FulfillmentOutboxDispatchGate implements OutboxDispatchGate {
  constructor(private readonly workflow: FulfillmentWorkflowGate) {}

  pausedRows(): OutboxDispatchPause | null {
    if (this.workflow.shouldDispatchFulfillmentEvents()) return null;
    return {
      topics: [SHIPMENT_STREAM.topic.topic, FULFILLMENT_V2_STREAM.topic.topic],
      eventTypePrefixes: ['Fulfillment', 'Shipment'],
    };
  }
}

/**
 * `@Global()` 인 이유: 공용 디스패처는 아웃박스를 켠 `EventsModule.forApp` 안에서 만들어지는데
 * (core 에서는 catalog), 이 게이트는 fulfillment 의 정책이다. 두 모듈은 서로를 import 하지
 * 않으므로 토큰이 전역이어야 optional 주입이 닿는다. `FulfillmentWorkflowGate` 를 여기서도
 * 제공하는 것은 env 파생 무상태 객체라 인스턴스가 둘이어도 같은 답을 내기 때문이다.
 */
@Global()
@Module({
  providers: [
    FulfillmentWorkflowGate,
    FulfillmentOutboxDispatchGate,
    { provide: OUTBOX_DISPATCH_GATE, useExisting: FulfillmentOutboxDispatchGate },
  ],
  exports: [OUTBOX_DISPATCH_GATE],
})
export class FulfillmentOutboxDispatchGateModule {}
