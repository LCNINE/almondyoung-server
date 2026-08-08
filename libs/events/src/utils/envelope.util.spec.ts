import { parseEnvelope } from './envelope.util';

const ENVELOPE = {
  messageId: 'msg-1',
  messageType: 'OrderCreated',
  messageKind: 'event',
  source: { service: 'core', aggregateType: 'Order', aggregateId: 'order-1' },
  payload: { orderId: 'order-1' },
};

describe('parseEnvelope', () => {
  it('객체를 그대로 받는다 — 운영에서 Nest KafkaParser 가 넘기는 형태다', () => {
    // 이것이 회귀의 핵심. `String(object)` 는 "[object Object]" 가 되어
    // JSON.parse 가 터지고, 그 결과 소비자가 통째로 멎었다.
    expect(parseEnvelope(ENVELOPE)).toEqual(ENVELOPE);
  });

  it('Buffer 를 파싱한다', () => {
    expect(parseEnvelope(Buffer.from(JSON.stringify(ENVELOPE)))).toEqual(ENVELOPE);
  });

  it('문자열을 파싱한다', () => {
    expect(parseEnvelope(JSON.stringify(ENVELOPE))).toEqual(ENVELOPE);
  });

  it('null/undefined 는 던진다', () => {
    expect(() => parseEnvelope(null)).toThrow(/null or undefined/);
    expect(() => parseEnvelope(undefined)).toThrow(/null or undefined/);
  });

  it('깨진 JSON 은 던진다', () => {
    expect(() => parseEnvelope('{not json')).toThrow();
  });
});
