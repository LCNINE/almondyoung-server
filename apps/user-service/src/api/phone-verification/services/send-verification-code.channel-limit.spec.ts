import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import { SendMessageService } from './send-verification-code.service';
import { PhoneVerificationException } from '../exceptions/phone-verification.exceptions';

const dialect = new PgDialect();

function paramsOf(condition: SQL): unknown[] {
  return dialect.sqlToQuery(condition).params;
}

function makeService(recentSendCount: number) {
  const captured: { countParams: unknown[]; inserted: Record<string, unknown> } = {
    countParams: [],
    inserted: {},
  };

  const trx = {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          captured.countParams = paramsOf(condition);
          return { limit: () => Promise.resolve(Array.from({ length: recentSendCount }, (_, i) => ({ id: i }))) };
        },
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        captured.inserted = row;
        return Promise.resolve();
      },
    }),
  };

  const smsSender = { send: jest.fn().mockResolvedValue(undefined) };

  const service = new SendMessageService(
    { db: { transaction: (fn: (tx: unknown) => unknown) => fn(trx) } } as never,
    { expireExistingCodes: jest.fn().mockResolvedValue(undefined) } as never,
    smsSender as never,
  );

  return { service, captured, smsSender };
}

const dto = { countryCode: 'KR', phoneNumber: '+821022720693' };

describe('인증번호 발송 한도는 채널별로 센다', () => {
  it('카카오톡 요청은 카카오톡 발송만 세고, 그 채널로 기록한다', async () => {
    const { service, captured, smsSender } = makeService(0);

    await service.sendVerificationCode({ ...dto, channel: 'KAKAO' });

    expect(captured.countParams).toContain('KAKAO');
    expect(captured.countParams).not.toContain('SMS');
    expect(captured.inserted.channel).toBe('KAKAO');
    expect(smsSender.send).toHaveBeenCalledWith(dto.phoneNumber, expect.any(String), 'KAKAO');
  });

  it('채널을 생략하면 문자로 세고 문자로 기록한다', async () => {
    const { service, captured } = makeService(0);

    await service.sendVerificationCode(dto);

    expect(captured.countParams).toContain('SMS');
    expect(captured.countParams).not.toContain('KAKAO');
    expect(captured.inserted.channel).toBe('SMS');
  });

  it('문자 한도가 찼어도 카카오톡은 자기 한도로 판정한다', async () => {
    const { service, smsSender } = makeService(3);

    await expect(service.sendVerificationCode(dto)).rejects.toBeInstanceOf(PhoneVerificationException);
    expect(smsSender.send).not.toHaveBeenCalled();

    const kakao = makeService(0);
    await expect(kakao.service.sendVerificationCode({ ...dto, channel: 'KAKAO' })).resolves.toContain('카카오톡');
  });

  it('한도 초과 안내는 횟수와 시간을 노출하지 않는다', async () => {
    const { service } = makeService(3);

    const error = (await service.sendVerificationCode(dto).catch((e: unknown) => e)) as Error;

    expect(error.message).not.toMatch(/\d/);
  });
});
