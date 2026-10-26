import { CmsAgreementService } from './cms-agreement.service';

describe('CmsAgreementService.uploadAgreement — 가입 요청 적재', () => {
  const insertedRow = { id: 'agreement-row-1', status: '등록' };

  function build() {
    const trx = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([insertedRow]) }),
      }),
    };
    const dbService = { run: jest.fn((fn: (t: unknown) => unknown) => fn(trx)) };
    const cmsApi = {
      uploadAgreement: jest.fn().mockResolvedValue({
        ok: true,
        data: { agreementFile: { agreementKey: 'k1', registerStatus: '등록' } },
      }),
    };
    const cmsMemberService = { findByCmsMemberId: jest.fn().mockResolvedValue({ id: 'm1' }) };
    const publisher = { enqueue: jest.fn() };
    const service = new CmsAgreementService(
      dbService as never,
      cmsApi as never,
      cmsMemberService as never,
      publisher as never,
    );
    return { service, publisher, trx };
  }

  it('가입 의도가 있으면 동의자료 기록과 같은 트랜잭션에 가입 요청을 적재한다', async () => {
    const { service, publisher, trx } = build();

    await service.uploadAgreement('CMS1', Buffer.from('x'), '서면', 'png', {
      userId: 'user-1',
      billingMethodId: 'bm-1',
      planId: 'plan-1',
      termsAgreementId: 'terms-1',
    });

    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'cms.signup.requested',
        idempotencyKey: 'cms:signup-requested:agreement-row-1',
        payload: expect.objectContaining({
          cmsAgreementId: 'agreement-row-1',
          billingMethodId: 'bm-1',
          userId: 'user-1',
          planId: 'plan-1',
          termsAgreementId: 'terms-1',
        }),
      }),
      trx,
    );
  });

  it('가입 의도가 없으면 동의자료만 기록한다', async () => {
    const { service, publisher } = build();

    const row = await service.uploadAgreement('CMS1', Buffer.from('x'), '서면', 'png');

    expect(row).toBe(insertedRow);
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });
});
