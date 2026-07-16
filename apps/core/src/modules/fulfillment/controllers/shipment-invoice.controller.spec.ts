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
