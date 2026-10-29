import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { AdminSalesOrderCancellationController } from './admin-sales-order-cancellation.controller';

/** 옛 반품·교환 컨트롤러에서 옮긴 취소·환불 라우트 넷 (K8 PR 10 N3) — 경로·권한이 그대로여야 admin-web 이 무변경이다. */
describe('AdminSalesOrderCancellationController', () => {
  it('admin 아래에 산다', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminSalesOrderCancellationController)).toBe('admin');
  });

  it.each([
    ['adminCancelOrder', 'sales-orders/:id/cancel', 'order.order.cancel'],
    ['adminRetryRefund', 'sales-orders/:id/retry-refund', 'payment.refund.execute'],
    ['adminManualRefundComplete', 'sales-orders/:id/manual-refund-complete', 'payment.refund.execute'],
    ['adminWaiveRefund', 'sales-orders/:id/refund-waive', 'payment.refund.execute'],
  ] as const)('%s 는 %s · %s', (methodName, path, permission) => {
    const method = Object.getOwnPropertyDescriptor(AdminSalesOrderCancellationController.prototype, methodName)
      ?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method)).toEqual([permission]);
  });

  it('Idempotency-Key 가 없으면 취소를 부르지 않는다', () => {
    const service = { adminCancelRequest: jest.fn() };
    const controller = new AdminSalesOrderCancellationController(service as never);

    expect(() => controller.adminCancelOrder('so-1', {}, '  ', { userId: 'admin-1' })).toThrow(BadRequestException);
    expect(service.adminCancelRequest).not.toHaveBeenCalled();
  });

  it('취소는 트림한 키와 행위자를 명령 문맥으로 싣는다', async () => {
    const service = { adminCancelRequest: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new AdminSalesOrderCancellationController(service as never);

    await expect(
      controller.adminCancelOrder('so-1', { reasonCode: 'OUT_OF_STOCK' }, ' key-1 ', {
        userId: 'admin-1',
        roles: ['cs'],
      }),
    ).resolves.toEqual({ ok: true });
    expect(service.adminCancelRequest).toHaveBeenCalledWith('so-1', {
      reasonCode: 'OUT_OF_STOCK',
      fulfillmentCommandContext: { idempotencyKey: 'key-1', actorId: 'admin-1', actorRoles: ['cs'] },
    });
  });
});
