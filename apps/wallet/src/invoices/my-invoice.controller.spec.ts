import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MyInvoiceController } from './my-invoice.controller';

function make(owned: { invoiceId: string; status: string } | null) {
  const queryService = {
    findMineByUserId: jest.fn().mockResolvedValue([{ invoiceId: 'inv1' }]),
    findOwnedInvoice: jest.fn().mockResolvedValue(owned),
  };
  const executor = { executeInvoiceById: jest.fn().mockResolvedValue(undefined) };
  const controller = new MyInvoiceController(queryService as never, executor as never);
  return { controller, queryService, executor };
}

const req = { jwtUserId: 'user-1' } as never;

describe('MyInvoiceController', () => {
  it('list → 인증 userId + status 로 위임', async () => {
    const { controller, queryService } = make(null);
    await controller.list(req, 'PAST_DUE');
    expect(queryService.findMineByUserId).toHaveBeenCalledWith('user-1', 'PAST_DUE');
  });

  it('retry → 소유하지 않은 인보이스면 404, 집행 안 함', async () => {
    const { controller, executor } = make(null);
    await expect(controller.retry(req, 'inv-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(executor.executeInvoiceById).not.toHaveBeenCalled();
  });

  it('retry → PAST_DUE 아니면 400, 집행 안 함', async () => {
    const { controller, executor } = make({ invoiceId: 'inv1', status: 'MANDATE_PENDING' });
    await expect(controller.retry(req, 'inv1')).rejects.toBeInstanceOf(BadRequestException);
    expect(executor.executeInvoiceById).not.toHaveBeenCalled();
  });

  it('retry → 본인 소유 PAST_DUE 만 집행', async () => {
    const { controller, executor } = make({ invoiceId: 'inv1', status: 'PAST_DUE' });
    const res = await controller.retry(req, 'inv1');
    expect(executor.executeInvoiceById).toHaveBeenCalledWith('inv1');
    expect(res).toEqual({ invoiceId: 'inv1', retried: true });
  });
});
