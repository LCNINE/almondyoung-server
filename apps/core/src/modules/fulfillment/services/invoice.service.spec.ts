import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { InvoiceService } from './invoice.service';

describe('InvoiceService.markAsShipped', () => {
  const foId = 'fo-11111111-1111-1111-1111-111111111111';
  const invoiceId = 'inv-22222222-2222-2222-2222-222222222222';

  type InvoiceRow = {
    id: string;
    fulfillmentOrderId: string;
    issueMethod: 'goodsflow' | 'direct' | 'self';
    invoiceNumber: string;
    status: 'issued' | 'printed' | 'shipped' | 'canceled';
  };

  function makeTx(invoiceRow: InvoiceRow | null) {
    const tx: any = {
      select: jest.fn(() => ({
        from: (_table: unknown) => ({
          where: (_where: unknown) => ({
            limit: (_n: number) => ({
              then: (fn: (rows: InvoiceRow[]) => unknown) =>
                Promise.resolve(fn(invoiceRow ? [invoiceRow] : [])),
            }),
          }),
        }),
      })),
      update: jest.fn(() => ({
        set: () => ({ where: () => Promise.resolve() }),
      })),
    };
    return tx;
  }

  function makeService(invoiceRow: InvoiceRow | null) {
    const tx = makeTx(invoiceRow);
    const dbService: any = { db: { transaction: jest.fn((fn) => fn(tx)) } };
    const fulfillmentsService: any = { ship: jest.fn().mockResolvedValue(undefined) };

    const service = new InvoiceService(dbService, fulfillmentsService);
    return { service, tx, fulfillmentsService };
  }

  it('goodsflow printed invoice → ship() 호출로 FulfillmentShipped 발행 경로 연결', async () => {
    const { service, fulfillmentsService } = makeService({
      id: invoiceId,
      fulfillmentOrderId: foId,
      issueMethod: 'goodsflow',
      invoiceNumber: 'GF-INV-001',
      status: 'printed',
    });

    await service.markAsShipped(invoiceId);

    expect(fulfillmentsService.ship).toHaveBeenCalledWith(foId, expect.anything());
  });

  it('direct invoice issued 상태 → ship() 호출 (goodsflow print 불필요)', async () => {
    const { service, fulfillmentsService } = makeService({
      id: invoiceId,
      fulfillmentOrderId: foId,
      issueMethod: 'direct',
      invoiceNumber: 'INV-DIRECT-001',
      status: 'issued',
    });

    await service.markAsShipped(invoiceId);

    expect(fulfillmentsService.ship).toHaveBeenCalledWith(foId, expect.anything());
  });

  it('self invoice printed 상태 → ship() 호출', async () => {
    const { service, fulfillmentsService } = makeService({
      id: invoiceId,
      fulfillmentOrderId: foId,
      issueMethod: 'self',
      invoiceNumber: 'INV-SELF-001',
      status: 'printed',
    });

    await service.markAsShipped(invoiceId);

    expect(fulfillmentsService.ship).toHaveBeenCalledWith(foId, expect.anything());
  });

  it('goodsflow invoice issued 상태 → ConflictException (printed 필요)', async () => {
    const { service } = makeService({
      id: invoiceId,
      fulfillmentOrderId: foId,
      issueMethod: 'goodsflow',
      invoiceNumber: 'GF-INV-002',
      status: 'issued',
    });

    await expect(service.markAsShipped(invoiceId)).rejects.toThrow(ConflictException);
  });

  it('이미 shipped 상태인 invoice → early return, ship() 미호출', async () => {
    const { service, fulfillmentsService } = makeService({
      id: invoiceId,
      fulfillmentOrderId: foId,
      issueMethod: 'goodsflow',
      invoiceNumber: 'GF-INV-003',
      status: 'shipped',
    });

    await service.markAsShipped(invoiceId);

    expect(fulfillmentsService.ship).not.toHaveBeenCalled();
  });

  it('invoice 없음 → NotFoundException', async () => {
    const { service } = makeService(null);

    await expect(service.markAsShipped(invoiceId)).rejects.toThrow(NotFoundException);
  });
});
