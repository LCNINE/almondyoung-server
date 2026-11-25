import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { BatchPickListDto } from '../dto/batch-pick-list.dto';
import { BatchPickListReader } from '../reader/batch-pick-list';

@ApiTags('Outbound Batches')
@Controller()
export class BatchPickListController {
  constructor(private readonly pickList: BatchPickListReader) {}

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/:batchId/pick-list')
  @ApiOperation({ summary: '배치 피킹 목록 — 위치·상품별로 합친 집을 수량과 집은 수량' })
  @ApiOkResponse({ type: BatchPickListDto })
  pickListOf(@Param('batchId', ParseUUIDPipe) batchId: string): Promise<BatchPickListDto> {
    return this.pickList.forBatch(batchId);
  }
}
