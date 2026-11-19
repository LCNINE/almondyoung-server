import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { StockProjectionController } from './stock-projection.controller';

describe('grouped stock route contract', () => {
  it('exposes the read-only route with the same stock permission as the existing summary', () => {
    const route = StockProjectionController.prototype.listStockSummariesByGroup;
    const existing = StockProjectionController.prototype.listStockSummaries;

    expect(Reflect.getMetadata(PATH_METADATA, StockProjectionController)).toBe('inventory');
    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe('/stocks/summary/by-group');
    expect(Reflect.getMetadata(METHOD_METADATA, route)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, route)).toEqual(['inventory.stock.read']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, route)).toEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, existing),
    );
  });
});
