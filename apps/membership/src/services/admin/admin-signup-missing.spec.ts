import { pickSignupMissing } from './admin-members.reader';

describe('pickSignupMissing', () => {
  const account = (userId: string, latestAgreementAt: string, billingMethodId = `bm-${userId}`) => ({
    userId,
    billingMethodId,
    cmsMemberStatus: 'PENDING',
    latestAgreementAt,
  });

  it('계약이 한 번도 없으면 누락이다', () => {
    const result = pickSignupMissing([account('u1', '2026-10-15T00:00:00.000Z')], new Map());
    expect(result).toEqual([expect.objectContaining({ userId: 'u1', lastContractAt: null })]);
  });

  it('계좌 등록보다 계약이 뒤면 빠진다 — 해지하고 계좌만 남긴 회원', () => {
    const result = pickSignupMissing(
      [account('u1', '2026-08-10T00:00:00.000Z')],
      new Map([['u1', new Date('2026-08-10T00:01:00.000Z')]]),
    );
    expect(result).toEqual([]);
  });

  it('예전 가입 뒤에 계좌를 다시 등록했는데 가입이 없으면 누락이다', () => {
    const result = pickSignupMissing(
      [account('u1', '2026-10-15T00:00:00.000Z')],
      new Map([['u1', new Date('2026-08-10T00:00:00.000Z')]]),
    );
    expect(result).toEqual([expect.objectContaining({ userId: 'u1', lastContractAt: '2026-08-10T00:00:00.000Z' })]);
  });

  it('계좌가 여럿이면 가장 최근 계좌로 판정한다', () => {
    const result = pickSignupMissing(
      [account('u1', '2026-10-15T00:00:00.000Z', 'new'), account('u1', '2026-07-01T00:00:00.000Z', 'old')],
      new Map(),
    );
    expect(result).toEqual([expect.objectContaining({ billingMethodId: 'new' })]);
  });
});
