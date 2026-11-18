import { ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { PII_RESPONSE_KEY, REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { StockProjectionController } from './stock-projection.controller';
import { StockProjectionService } from '../services/stock-projection.service';

describe('unshipped orders route', () => {
  it('declares stock read permission and masks orderer names with sales order subjects', () => {
    const route = StockProjectionController.prototype.listUnshippedOrders;

    expect(Reflect.getMetadata(PATH_METADATA, StockProjectionController)).toBe('inventory');
    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe('stocks/sku/:skuId/warehouse/:warehouseId/unshipped-orders');
    expect(Reflect.getMetadata(METHOD_METADATA, route)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, route)).toEqual(['inventory.stock.read']);
    expect(Reflect.getMetadata(PII_RESPONSE_KEY, route)).toEqual({
      fields: { 'items[].customerName': 'name' },
      subjects: [{ path: 'items[].salesOrderId', type: 'sales_order' }],
    });
  });

  it('validates both path identifiers with ParseUUIDPipe', async () => {
    const args: Record<string, { data: string; pipes: ParseUUIDPipe[] }> = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      StockProjectionController,
      'listUnshippedOrders',
    );

    expect(
      Object.values(args)
        .map((arg) => arg.data)
        .sort(),
    ).toEqual(['skuId', 'warehouseId']);

    for (const arg of Object.values(args)) {
      expect(arg.pipes[0]).toBeInstanceOf(ParseUUIDPipe);
      await expect(arg.pipes[0].transform('invalid', { type: 'param', data: arg.data })).rejects.toThrow();
      await expect(
        arg.pipes[0].transform('00000000-0000-0000-0000-000000000001', { type: 'param', data: arg.data }),
      ).resolves.toBe('00000000-0000-0000-0000-000000000001');
    }
  });

  it('delegates to the service and returns the items envelope', async () => {
    const listUnshippedOrders = jest.fn().mockResolvedValue({ items: [] });
    const module = await Test.createTestingModule({
      controllers: [StockProjectionController],
      providers: [{ provide: StockProjectionService, useValue: { listUnshippedOrders } }],
    }).compile();
    const controller = module.get(StockProjectionController);

    expect(await controller.listUnshippedOrders('sku', 'warehouse')).toEqual({ items: [] });
    expect(listUnshippedOrders).toHaveBeenCalledWith('sku', 'warehouse');

    await module.close();
  });
});
