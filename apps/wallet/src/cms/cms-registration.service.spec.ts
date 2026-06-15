import { CmsRegistrationService } from './cms-registration.service';

describe('CmsRegistrationService agreement file type', () => {
  const billingMethod = {
    id: 'billing-method-1',
    userId: 'user-1',
    providerType: 'CMS_BATCH',
    displayName: null,
    status: 'ACTIVE',
    createdAt: new Date(),
  };
  const cmsMember = {
    id: 'cms-member-row-1',
    billingMethodId: 'billing-method-1',
    userId: 'user-1',
    cmsMemberId: 'CMSMEMBER1',
    paymentCompany: '088',
    payerName: '홍길동',
    payerNumber: '900101',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('uploads PNG signature as written agreement material', async () => {
    const cmsMemberService = {
      registerMember: jest.fn().mockResolvedValue({ billingMethod, cmsMember }),
    };
    const cmsAgreementService = {
      uploadAgreement: jest.fn().mockResolvedValue({ id: 'agreement-1', status: '등록' }),
    };
    const billingMethodService = { findById: jest.fn() };
    const service = new CmsRegistrationService(
      cmsMemberService as never,
      cmsAgreementService as never,
      billingMethodService as never,
    );

    await service.registerWithAgreement(
      'user-1',
      {
        paymentCompany: '088',
        payerName: '홍길동',
        payerNumber: '900101',
        paymentNumber: '1234567890',
        phone: '01012345678',
      },
      Buffer.from('png'),
      'png',
    );

    expect(cmsAgreementService.uploadAgreement).toHaveBeenCalledWith('CMSMEMBER1', expect.any(Buffer), '서면', 'png');
  });
});
