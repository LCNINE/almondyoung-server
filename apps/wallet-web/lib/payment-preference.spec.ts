import {
  parsePaymentPreference,
  readPaymentPreference,
  stagePaymentPreference,
  completePaymentPreference,
} from './payment-preference';

describe('last successful payment preference', () => {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
  };
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() });
  });
  afterAll(() => {
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  it('keeps the previous choice until approval and isolates customers', () => {
    stagePaymentPreference('first', 'alice', { method: '네이버페이' });
    completePaymentPreference('first');
    stagePaymentPreference('cancelled', 'alice', { method: '신용·체크카드', cardCompany: '61' });
    expect(readPaymentPreference('alice')).toEqual({ method: '네이버페이' });
    expect(readPaymentPreference('bob')).toBeNull();
    completePaymentPreference('unrelated');
    expect(readPaymentPreference('alice')).toEqual({ method: '네이버페이' });
    completePaymentPreference('cancelled');
    expect(readPaymentPreference('alice')).toEqual({ method: '신용·체크카드', cardCompany: '61' });
    expect(sessionStorage.getItem('wallet:pending-payment:cancelled')).toBeNull();
  });
  it('rejects unknown methods/card companies and never restores points or agreement', () => {
    expect(parsePaymentPreference('{')).toBeNull();
    expect(parsePaymentPreference('{"method":"무통장입금"}')).toBeNull();
    expect(parsePaymentPreference('{"method":"신용·체크카드","cardCompany":"invalid"}')).toBeNull();
    expect(parsePaymentPreference('{"method":"BRANDPAY","points":5000,"agreed":true,"installment":12}')).toEqual({
      method: 'BRANDPAY',
    });
  });
  it('does not interrupt checkout when storage is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('blocked');
      },
    });
    expect(readPaymentPreference('alice')).toBeNull();
    stagePaymentPreference('test', 'alice', { method: '토스페이' });
    expect(() => completePaymentPreference('test')).not.toThrow();
  });
});
