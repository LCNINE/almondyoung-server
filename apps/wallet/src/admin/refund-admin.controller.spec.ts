import { BadRequestException } from '@nestjs/common';
import { RefundAdminController } from './refund-admin.controller';

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
