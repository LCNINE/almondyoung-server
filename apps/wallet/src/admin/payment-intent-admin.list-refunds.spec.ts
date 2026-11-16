import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { AdminRefundListQueryDto } from './dto/admin-refund.dto';
import { PaymentIntentAdminService } from './payment-intent-admin.service';

it('환불 조회에 기존 계좌와 결제수단을 포함하고 AUTO PENDING 수동 완료를 막는다', async () => {
  const account = { bank: '06', accountNumber: '1234567890', holderName: '테스트' };
  const rows = [
    {
      id: 'rf-1',
      status: 'PENDING',
      execution: 'MANUAL',
      paymentMethodType: 'BANK_TRANSFER',
      refundReceiveAccount: account,
    },
    {
      id: 'rf-2',
      status: 'PENDING',
      execution: 'AUTO',
      paymentMethodType: 'BANK_TRANSFER',
      refundReceiveAccount: null,
    },
  ];
  const conditions: SQL[] = [];
  const ordering: SQL[] = [];
  const limits: number[] = [];
  const offsets: number[] = [];
  const query = {
    leftJoin: () => query,
    $dynamic: () => query,
    where: (condition: SQL) => {
      conditions.push(condition);

      return Object.assign(Promise.resolve([{ value: 2 }]), {
        orderBy: (...columns: SQL[]) => {
          ordering.push(...columns);

          return {
            limit: (limit: number) => {
              limits.push(limit);

              return {
                offset: (offset: number) => {
                  offsets.push(offset);

                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      });
    },
  };
  const service = new PaymentIntentAdminService(
    { db: { select: () => ({ from: () => query }) } } as never,
    {} as never,
  );
  const result = await service.listRefunds({ page: 2, limit: 20, intentIds: ['pi-1', 'pi-2'] });

  expect(conditions.map((condition) => new PgDialect().sqlToQuery(condition).params)).toEqual([
    ['pi-1', 'pi-2'],
    ['pi-1', 'pi-2'],
  ]);
  expect(new PgDialect().sqlToQuery(conditions[0]).sql).toContain(' in (');
  expect(ordering.map((column) => new PgDialect().sqlToQuery(column).sql)).toEqual([
    '"refunds"."created_at" desc',
    '"refunds"."id" desc',
  ]);
  expect(limits).toEqual([20]);
  expect(offsets).toEqual([20]);
  expect(result).toMatchObject({ page: 2, limit: 20, total: 2 });

  expect(result.data).toMatchObject([
    { id: 'rf-1', paymentMethodType: 'BANK_TRANSFER', refundReceiveAccount: account, manualConfirmable: true },
    { id: 'rf-2', refundReceiveAccount: null, manualConfirmable: false },
  ]);
});

it('묶음 결제 필터는 UUID 목록으로 변환하고 빈 목록·잘못된 ID·100개 초과를 거절한다', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const dto = plainToInstance(AdminRefundListQueryDto, { intentIds: `${id},${id}` });

  expect(dto.intentIds).toEqual([id, id]);
  expect(await validate(dto)).toEqual([]);

  for (const intentIds of ['', [], ['invalid'], Array(101).fill(id)]) {
    expect((await validate(plainToInstance(AdminRefundListQueryDto, { intentIds }))).length).toBeGreaterThan(0);
  }
});
