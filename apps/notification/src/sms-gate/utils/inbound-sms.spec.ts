import { createHmac } from 'node:crypto';
import { isOptOutMessage, isValidSignature } from './inbound-sms';

describe('isOptOutMessage', () => {
  it.each(['수신거부', '수신 거부합니다', '그만 보내세요', 'STOP'])('%s 는 수신거부', (m) => {
    expect(isOptOutMessage(m)).toBe(true);
  });

  it('일반 문의는 수신거부가 아니다', () => {
    expect(isOptOutMessage('배송 언제 와요?')).toBe(false);
  });
});

describe('isValidSignature', () => {
  const body = Buffer.from('{"event":"sms:received"}');
  const sign = (key: string) => createHmac('sha256', key).update(Buffer.concat([body, Buffer.from('1700000000')])).digest('hex');

  it('같은 키로 만든 서명만 통과한다', () => {
    expect(isValidSignature('k', body, '1700000000', sign('k'))).toBe(true);
    expect(isValidSignature('k', body, '1700000000', sign('other'))).toBe(false);
    expect(isValidSignature('k', body, undefined, sign('k'))).toBe(false);
  });
});
