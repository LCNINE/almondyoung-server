import { fieldCaptureActorOf, normalizePositionCode } from './sku-field-capture.rules';

describe('normalizePositionCode', () => {
  it('앞뒤 공백을 지우고 대문자로', () => expect(normalizePositionCode('  t-01-20 \n')).toBe('T-01-20'));
  it('한글 위치는 그대로', () => expect(normalizePositionCode('케이영 창고')).toBe('케이영 창고'));
});

describe('fieldCaptureActorOf', () => {
  it('login_id 를 우선 label 로', () =>
    expect(fieldCaptureActorOf({ userId: 'u1', login_id: 'worker01', email: 'w@x.kr' })).toEqual({
      workerId: 'u1',
      workerLabel: 'worker01',
    }));
  it('login_id 없으면 email', () =>
    expect(fieldCaptureActorOf({ id: 'u2', email: 'w@x.kr' })).toEqual({ workerId: 'u2', workerLabel: 'w@x.kr' }));
  it('id 가 없으면 던진다', () => expect(() => fieldCaptureActorOf({ email: 'w@x.kr' })).toThrow());
});
