import { FULFILLMENT_STREAM } from './fulfillments.stream';

/**
 * K6 PR4(D11) — `FulfillmentCancelled` 는 유일한 생산자(FO 취소 `POST /fulfillments/:id/cancel`)와 함께 계약째 지웠다.
 * (원래 channel-adapter `fulfillment-events.consumer.spec.ts` 에 있었고, 그 소비자를 #1452 에서 지우면서 계약 옆으로 옮겼다.)
 */
describe('FULFILLMENT_STREAM 계약', () => {
  it('FulfillmentCancelled 가 없다 (K6 D11)', () => {
    expect(Object.keys(FULFILLMENT_STREAM.events)).not.toContain('FulfillmentCancelled');
  });
});
