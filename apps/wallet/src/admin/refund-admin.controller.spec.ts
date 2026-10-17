import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RefundAdminController } from './refund-admin.controller';
import { ChangeRefundKindDto } from './dto';

function controllerWith(confirmManual: jest.Mock) {
  return new RefundAdminController({} as never, { confirmManual } as never);
}

describe('RefundAdminController.confirmManual — 오류 상태 코드', () => {
  it('서비스가 던진 HttpException 은 그대로 내보낸다(500 으로 바꾸지 않는다)', async () => {
    const refusal = new BadRequestException({ error: 'REFUND_NOT_MANUALLY_CONFIRMABLE', message: '수동 완료 불가' });
    await expect(controllerWith(jest.fn().mockRejectedValue(refusal)).confirmManual('rf-1')).rejects.toBe(refusal);
  });

  it('옛 문자열 오류(PENDING 아님)는 지금처럼 400', async () => {
    const confirm = jest.fn().mockRejectedValue(new Error('환불이 PENDING 상태가 아닙니다: SUCCEEDED'));
    await expect(controllerWith(confirm).confirmManual('rf-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PATCH :id/kind — 바디 검증과 위임', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ChangeRefundKindDto });

  it('모르는 종류 문자열은 400', async () => {
    await expect(validate({ kind: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kind 가 아예 없는 바디도 400 — 비우려면 null 을 명시해야 한다', async () => {
    await expect(validate({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('null(비우기)과 정의된 종류는 통과', async () => {
    await expect(validate({ kind: null })).resolves.toMatchObject({ kind: null });
    await expect(validate({ kind: 'RETURN' })).resolves.toMatchObject({ kind: 'RETURN' });
  });

  it('액터는 토큰의 jwtUserId, 없으면 admin 으로 서비스에 넘긴다', async () => {
    const changeKind = jest.fn().mockResolvedValue({
      id: 'rf-1',
      chargeId: 'c',
      intentId: 'i',
      status: 'SUCCEEDED',
      amount: 1,
      currency: 'KRW',
      reasonCode: null,
      reasonMessage: null,
      createdAt: new Date(),
      execution: 'AUTO',
      kind: null,
      failureCode: null,
      retryable: null,
    });
    const controller = new RefundAdminController({} as never, { changeKind } as never);
    await controller.changeKind({ jwtUserId: 'admin-7' } as never, 'rf-1', { kind: null });
    expect(changeKind).toHaveBeenCalledWith('rf-1', null, 'admin-7');
    await controller.changeKind({} as never, 'rf-1', { kind: 'RETURN' });
    expect(changeKind).toHaveBeenLastCalledWith('rf-1', 'RETURN', 'admin');
  });
});
