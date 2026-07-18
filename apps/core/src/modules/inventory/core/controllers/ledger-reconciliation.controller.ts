import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LedgerReconciliationService } from '../services/ledger-reconciliation.service';
import { LedgerReconciliationReportDto, ReservationDriftReportDto } from '../dto/ledger-reconciliation.dto';

@ApiTags('Inventory - Ledger Reconciliation')
@Controller('inventory/ledger-reconciliation')
export class LedgerReconciliationController {
  constructor(private readonly reconciliationService: LedgerReconciliationService) {}

  @Get()
  @ApiOperation({
    summary: '원장 대사 (탐지 전용)',
    description: 'stock_events(진실) 와 stock_ledgers(파생) 의 불일치 grain 을 조회합니다. 원장을 수정하지 않습니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID 로 대상 grain 을 좁힘' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID 로 대상 grain 을 좁힘' })
  @ApiResponse({ status: 200, description: '대사 리포트', type: LedgerReconciliationReportDto })
  async getReconciliation(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
  ): Promise<LedgerReconciliationReportDto> {
    return this.reconciliationService.reconcile({ warehouseId, skuId });
  }

  @Get('reservations')
  @ApiOperation({
    summary: '예약 불변식 대사 (탐지 전용)',
    description: 'ON_HAND 원장 합 < confirmed 예약 합 인 (sku,warehouse) grain 을 조회합니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiResponse({ status: 200, type: ReservationDriftReportDto })
  async getReservationReconciliation(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
  ): Promise<ReservationDriftReportDto> {
    return this.reconciliationService.reconcileReservations({ warehouseId, skuId });
  }
}
