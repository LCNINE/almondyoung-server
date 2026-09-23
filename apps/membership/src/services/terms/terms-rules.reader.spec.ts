import { TermsRulesReader } from './terms-rules.reader';

/**
 * 기존 회원에게 불리한 새 약관이 «언제부터» 적용되는가. 고지 없이 적용되면 그 조항 자체가 다퉈진다.
 */
describe('TermsRulesReader.newRulesApply', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  function reader(opts: { effectiveAt?: string; agreed: boolean }) {
    const db = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(opts.agreed ? [{ id: 'a1' }] : []),
    };
    const config = { get: () => opts.effectiveAt };
    return new TermsRulesReader({ db } as never, config as never);
  }

  it('새 약관에 동의하고 들어온 가입이면 적용한다', async () => {
    await expect(reader({ agreed: true }).newRulesApply('c1', now)).resolves.toBe(true);
  });

  it('동의 이력이 없는 기존 회원은 적용일이 비어 있으면 적용하지 않는다(고지 전 기본값)', async () => {
    await expect(reader({ agreed: false }).newRulesApply('c1', now)).resolves.toBe(false);
  });

  it('기존 회원도 적용일이 지나면 적용한다', async () => {
    await expect(reader({ agreed: false, effectiveAt: '2026-09-30T15:00:00Z' }).newRulesApply('c1', now)).resolves.toBe(
      true,
    );
  });

  it('적용일 전이면 기존 회원에게 적용하지 않는다', async () => {
    await expect(reader({ agreed: false, effectiveAt: '2026-10-02T00:00:00Z' }).newRulesApply('c1', now)).resolves.toBe(
      false,
    );
  });

  it('적용일 값이 날짜가 아니면 없는 것으로 본다 — 잘못된 설정이 기존 회원 전원에게 적용되지 않게', async () => {
    await expect(reader({ agreed: false, effectiveAt: 'soon' }).newRulesApply('c1', now)).resolves.toBe(false);
  });
});
