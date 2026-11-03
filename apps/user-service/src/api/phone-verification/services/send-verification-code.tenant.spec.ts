import { SendMessageService } from './send-verification-code.service';

describe('휴대폰 인증번호 기록의 테넌트', () => {
  it('records the tenant this app serves — the customer-side screens that ask for codes are that tenant', async () => {
    const inserted: Record<string, unknown>[] = [];
    const trx = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve();
        },
      }),
    };
    const service = new SendMessageService(
      { db: { transaction: (fn: (tx: unknown) => unknown) => fn(trx) } } as never,
      { expireExistingCodes: jest.fn().mockResolvedValue(undefined) } as never,
      { send: jest.fn().mockResolvedValue(undefined) } as never,
      'acme',
    );

    await service.sendVerificationCode({ countryCode: 'KR', phoneNumber: '+821012345678' });

    expect(inserted).toEqual([expect.objectContaining({ phoneNumber: '+821012345678', tenantId: 'acme' })]);
  });
});
