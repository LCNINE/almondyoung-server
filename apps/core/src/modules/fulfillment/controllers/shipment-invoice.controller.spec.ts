import { UnauthorizedException } from '@nestjs/common';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ShipmentInvoiceController } from './shipment-invoice.controller';

describe('ShipmentInvoiceController authorization contract', () => {
  it('passes the JWT actor and idempotency key to invoice commands', async () => {
    const invoices = {
      issueForShipment: jest.fn().mockResolvedValue({ operationId: 'issue-operation' }),
      void: jest.fn().mockResolvedValue({ operationId: 'void-operation' }),
      getOperation: jest.fn(),
    };
    const controller = new ShipmentInvoiceController(invoices as never);
    const actor = { userId: 'jwt-actor', id: 'ignored-id', roles: ['logistics_manager'] };
    const issue = {
      expectedManifestVersion: 3,
      provider: 'goodsflow' as const,
      carrierCode: 'CJ',
      reason: 'issue label',
    };
    const voidRequest = { reason: 'void label' };

    await controller.issue('shipment-1', issue, 'issue-key', actor);
    await controller.void('invoice-1', voidRequest, 'void-key', actor);

    expect(invoices.issueForShipment).toHaveBeenCalledWith('shipment-1', issue, 'issue-key', {
      id: 'jwt-actor',
      roles: ['logistics_manager'],
    });
    expect(invoices.void).toHaveBeenCalledWith('invoice-1', voidRequest, 'void-key', {
      id: 'jwt-actor',
      roles: ['logistics_manager'],
    });
  });

  it('rejects a request without authenticated actor identity', () => {
    const controller = new ShipmentInvoiceController({} as never);

    expect(() => controller.issue('shipment-1', {} as never, 'key', {})).toThrow(UnauthorizedException);
  });

  it('requires operate for issue/read and reopen for void', () => {
    const metadata = (method: (...args: any[]) => unknown) => Reflect.getMetadata('required_scopes', method);

    expect(metadata(ShipmentInvoiceController.prototype.issue)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(ShipmentInvoiceController.prototype.operation)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(ShipmentInvoiceController.prototype.void)).toEqual([FULFILLMENT_SCOPE.SHIPMENT_REOPEN]);
  });
});

describe('ShipmentInvoiceController manual routes', () => {
  function make() {
    const invoices = {
      issueManualInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', status: 'issued' }),
      voidManualInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', status: 'voided' }),
    };
    const controller = new ShipmentInvoiceController(invoices as never);
    return { controller, invoices };
  }

  it('delegates manual issue with the resolved actor and idempotency key', async () => {
    const { controller, invoices } = make();
    const dto = { expectedManifestVersion: 1, carrierCode: 'HANJIN', trackingNo: 'H1' } as never;
    const result = await controller.issueManual('ship-1', dto, 'key-1', { userId: 'u-1', roles: ['master'] });
    expect(result).toMatchObject({ invoiceId: 'inv-1', status: 'issued' });
    expect(invoices.issueManualInvoice).toHaveBeenCalledWith('ship-1', dto, 'key-1', { id: 'u-1', roles: ['master'] });
  });

  it('defaults a missing idempotency key to empty string on void', async () => {
    const { controller, invoices } = make();
    await controller.voidManual('inv-1', {} as never, undefined, { userId: 'u-1', roles: [] });
    expect(invoices.voidManualInvoice).toHaveBeenCalledWith('inv-1', {}, '', { id: 'u-1', roles: [] });
  });

  it('rejects an unauthenticated actor', () => {
    const { controller } = make();
    expect(() => controller.issueManual('ship-1', {} as never, 'key-1', {})).toThrow();
  });
});
