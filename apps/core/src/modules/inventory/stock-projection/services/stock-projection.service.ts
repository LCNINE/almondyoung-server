import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { GetStockSummaryListQueryDto } from '../dto/stock-summary-list.dto';
import { InboundPipelineResponseDto } from '../dto/inbound-pipeline.dto';
import { StockProjectionReader } from './stock-projection.reader';
import { StockProjectionManager } from './stock-projection.manager';
import { InboundPipelineReader } from './inbound-pipeline.reader';

@Injectable()
export class StockProjectionService {
  constructor(
    private readonly reader: StockProjectionReader,
    private readonly manager: StockProjectionManager,
    private readonly inboundPipeline: InboundPipelineReader,
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
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

  getLocationContents(locationId: string, tx?: DbTx) {
    return this.reader.getLocationContents(locationId, tx);
  }

  getHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    return this.reader.getHistory(skuId, warehouseId, startDate, endDate);
  }

  getSkuSummary(skuId: string, tx?: DbTx) {
    return this.reader.getSkuSummary(skuId, tx);
  }

  /**
   * 판독은 열린 tx 를 요구한다(Reader 가 tx 를 필수로 받는 형태). 여기서 열어 넘겨
   * Controller 가 DbService 를 직접 주입받지 않게 한다 — WarehouseTransferService 와 같은 형태.
   */
  getInboundPipeline(
    input: { skuIds: string[]; toWarehouseId: string },
    tx?: DbTx,
  ): Promise<InboundPipelineResponseDto> {
    return this.dbService.run(async (trx) => ({ items: await this.inboundPipeline.read(trx, input) }), tx);
  }

  cancelEvent(eventId: string, reason: string) {
    return this.manager.cancelEvent(eventId, reason);
  }

  rebuildSummary(skuId: string, warehouseId: string) {
    return this.manager.rebuildSummary(skuId, warehouseId);
  }
}
