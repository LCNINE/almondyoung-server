import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { GetStockSummaryListQueryDto } from '../dto/stock-summary-list.dto';
import { StockProjectionReader } from './stock-projection.reader';
import { StockProjectionManager } from './stock-projection.manager';

@Injectable()
export class StockProjectionService {
  constructor(
    private readonly reader: StockProjectionReader,
    private readonly manager: StockProjectionManager,
  ) {}

  getCurrentStock(query: GetStockQueryDto, tx?: DbTx) {
    return this.reader.getCurrentStock(query, tx);
  }

  listStockSummaries(query: GetStockSummaryListQueryDto, tx?: DbTx) {
    return this.reader.listStockSummaries(query, tx);
  }

  getTotalBySku(skuId: string, tx?: DbTx) {
    return this.reader.getTotalBySku(skuId, tx);
  }

  getBySkuAndWarehouse(skuId: string, warehouseId: string, tx?: DbTx) {
    return this.reader.getBySkuAndWarehouse(skuId, warehouseId, tx);
  }

  getHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    return this.reader.getHistory(skuId, warehouseId, startDate, endDate);
  }

  getSkuSummary(skuId: string, tx?: DbTx) {
    return this.reader.getSkuSummary(skuId, tx);
  }

  cancelEvent(eventId: string, reason: string) {
    return this.manager.cancelEvent(eventId, reason);
  }

  rebuildSummary(skuId: string, warehouseId: string) {
    return this.manager.rebuildSummary(skuId, warehouseId);
  }
}
