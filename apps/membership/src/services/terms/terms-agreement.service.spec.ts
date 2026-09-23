import { TermsAgreementService } from './terms-agreement.service';
import { TermsAgreementManager } from './terms-agreement.manager';
import { ArrearsGate } from '../arrears/arrears.gate';
import { ArrearsOutstandingException } from '../../shared/exceptions/subscription.exceptions';

describe('TermsAgreementService', () => {
  const input = { userId: 'u1', termsVersion: 'v', billingMode: 'recurring' as const, planId: 'p1' };

  it('미납이 있으면 동의를 적지 않고 거절한다 — 자동이체 계좌를 등록하러 떠나기 전에 알린다', async () => {
    const record = jest.fn();
    const service = new TermsAgreementService(
      { record } as unknown as TermsAgreementManager,
      { assertNoOutstanding: jest.fn().mockRejectedValue(new ArrearsOutstandingException()) } as unknown as ArrearsGate,
    );

    await expect(service.record(input)).rejects.toBeInstanceOf(ArrearsOutstandingException);
    expect(record).not.toHaveBeenCalled();
  });

  it('미납이 없으면 그대로 적는다', async () => {
    const record = jest.fn().mockResolvedValue({ agreementId: 'a1' });
    const service = new TermsAgreementService(
      { record } as unknown as TermsAgreementManager,
      { assertNoOutstanding: jest.fn().mockResolvedValue(undefined) } as unknown as ArrearsGate,
    );

    await expect(service.record(input)).resolves.toEqual({ agreementId: 'a1' });
  });
});
