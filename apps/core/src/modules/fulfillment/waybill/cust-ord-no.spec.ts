import { deriveCustOrdNo } from './cust-ord-no';

describe('deriveCustOrdNo', () => {
  const A = '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  it('is 28 chars: AY + 26 base32', () => {
    expect(deriveCustOrdNo(A)).toHaveLength(28);
  });
  it('starts with AY and uses only Crockford base32 chars', () => {
    expect(deriveCustOrdNo(A)).toMatch(/^AY[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });
  it('is deterministic', () => {
    expect(deriveCustOrdNo(A)).toBe(deriveCustOrdNo(A));
  });
  it('is injective for distinct shipment ids', () => {
    expect(deriveCustOrdNo(A)).not.toBe(deriveCustOrdNo(B));
  });
  it('is ≤ 30 bytes (fits varchar(30))', () => {
    expect(Buffer.byteLength(deriveCustOrdNo(A), 'utf8')).toBeLessThanOrEqual(30);
  });
  it('rejects a non-uuid input', () => {
    expect(() => deriveCustOrdNo('not-a-uuid')).toThrow(/invalid uuid/);
  });
  it('접두사를 바꾸면 회수용 AR + 26자 = 28자, 기본 결과는 그대로 (K8 PR9)', () => {
    expect(deriveCustOrdNo(A, 'AR')).toMatch(/^AR[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(deriveCustOrdNo(A, 'AR').slice(2)).toBe(deriveCustOrdNo(A).slice(2));
    expect(deriveCustOrdNo(A)).toMatch(/^AY/);
  });
});
