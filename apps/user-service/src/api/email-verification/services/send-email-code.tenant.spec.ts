import { SendEmailCodeService } from './send-email-code.service';

describe('이메일 인증번호 기록의 테넌트', () => {
  it("records the signed-in account's tenant — the code goes to that account's own address", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ email: 'me@example.test', name: '나', tenantId: 'acme' }]) }),
        }),
      }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve();
        },
      }),
    };
    const service = new SendEmailCodeService(
      { db } as never,
      { publishEvent: jest.fn().mockResolvedValue(undefined) } as never,
      { expireExistingCodes: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await service.sendCode('u-1', {});

    expect(inserted).toEqual([expect.objectContaining({ email: 'me@example.test', tenantId: 'acme' })]);
  });
});
