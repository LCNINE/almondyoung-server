import { Controller, Post, Body, Get, Query, Param, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { InboundService } from '../services/inbound.service';
import { InboundPutawayReader } from '../services/inbound-putaway.reader';
import {
  SimpleInboundDto,
  IndividualInboundDto,
  PutawayRequestDto,
  ReturnInboundDto,
  CancelInboundDto,
  CreateInboundPlanDto,
  AddInboundPlanItemsDto,
  ListPlanItemsQueryDto,
  ReceiveFromPlanDto,
  UpdateInboundLineMemoDto,
} from '../dto/simple-inbound.dto';
import { PutawayPendingListDto } from '../dto/putaway-pending.dto';
import { IndividualInboundResponseDto, SimpleInboundResponseDto } from '../dto/inbound-response.dto';
import { InboundReceiptMapper } from '../mappers/inbound.mapper';

@ApiTags('Inbound')
@Controller('inbound')
@UseGuards(ScopeGuard)
export class InboundController {
  @Post('simple')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '간편입고 - SKU 리스트를 지정 위치로 즉시 입고' })
  @ApiResponse({ status: 201, description: '입고가 성공적으로 처리되었습니다.', type: SimpleInboundResponseDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async simpleInbound(@Body() dto: SimpleInboundDto) {
    const result = await this.inboundService.simpleInbound(dto);
    return InboundReceiptMapper.toSimpleResponseDto(result.receipt, result.lines);
  }

  @Post('simple-fullscan')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '전수조사 간편입고 - (서버는 간편입고와 동일 처리, 기록만 구분)' })
  @ApiResponse({
    status: 201,
    description: '전수조사 간편입고가 성공적으로 처리되었습니다.',
    type: SimpleInboundResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async simpleInboundFullscan(@Body() dto: SimpleInboundDto) {
    const result = await this.inboundService.simpleInboundFullscan(dto);
    return InboundReceiptMapper.toSimpleResponseDto(result.receipt, result.lines);
  }

  @ApiOperation({ summary: '입고 라인 메모 수정' })
  @ApiResponse({ status: 200, description: '메모가 수정되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  @Post('lines/:lineId/memo')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  async updateInboundLineMemo(@Param('lineId') lineId: string, @Body() dto: UpdateInboundLineMemoDto) {
    return this.inboundService.updateInboundLineMemo(lineId, dto);
  }

  @Post('individual')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '개별입고 - 단일 SKU를 지정(옵션) 로케로 입고' })
  @ApiResponse({
    status: 201,
    description: '개별입고가 성공적으로 처리되었습니다.',
    type: IndividualInboundResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async individualInbound(@Body() dto: IndividualInboundDto) {
    const result = await this.inboundService.individualInbound(dto);
    return InboundReceiptMapper.toIndividualResponseDto(result.receipt, result.line);
  }

  constructor(
    private readonly inboundService: InboundService,
    private readonly putawayReader: InboundPutawayReader,
  ) {}

  @Get('pending')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 예정 목록 조회' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
  @ApiResponse({ status: 200, description: '입고 예정 목록이 성공적으로 조회되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getInboundPending(@Query('warehouseId') warehouseId?: string) {
    return this.inboundService.getInboundPending(warehouseId);
  }

  @Get('history')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 실적 조회' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
  @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)', example: 30 })
  @ApiResponse({ status: 200, description: '입고 실적이 성공적으로 조회되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getInboundHistory(
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('days') days?: string,
  ) {
    return this.inboundService.getInboundHistory(skuId, warehouseId, days ? parseInt(days, 10) : 30);
  }

  @Post('verify-barcode')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 검수 - 바코드 스캔' })
  @ApiResponse({ status: 200, description: '바코드가 성공적으로 검증되었습니다.' })
  @ApiResponse({ status: 404, description: '바코드에 해당하는 SKU를 찾을 수 없습니다.' })
  @ApiResponse({ status: 400, description: '스캔한 SKU가 예상 SKU와 다릅니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async verifyInboundByBarcode(@Body() dto: { barcode: string; expectedSkuId?: string }) {
    return this.inboundService.verifyInboundByBarcode(dto.barcode, dto.expectedSkuId);
  }

  @Get('receipts')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고내역(현황) 조회 - (sku, quantity, occurredAt, method)' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'method', required: false, enum: ['individual', 'simple', 'simple_fullscan', 'planned'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listInboundReceipts(
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('method') method?: 'individual' | 'simple' | 'simple_fullscan' | 'planned',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inboundService.listInboundReceipts({
      skuId,
      warehouseId,
      method,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('work-logs')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 작업 타임라인 조회 (INBOUND/PUTAWAY/RETURN/CANCEL)' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['INBOUND', 'PUTAWAY', 'RETURN', 'CANCEL'] })
  @ApiQuery({ name: 'method', required: false, enum: ['individual', 'simple', 'simple_fullscan', 'planned'] })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listInboundWorkLogs(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
    @Query('type') type?: 'INBOUND' | 'PUTAWAY' | 'RETURN' | 'CANCEL',
    @Query('method') method?: 'individual' | 'simple' | 'simple_fullscan' | 'planned',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inboundService.listInboundWorkLogs({
      warehouseId,
      skuId,
      type,
      method,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('status')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '집계 입고현황(확정수량) 조회' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listInboundStatus(
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inboundService.listInboundStatus({
      skuId,
      warehouseId,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('putaway/pending')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '적치 대기 조회 — 시스템 존에 남은 미적치 잔량' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    example: 1,
    description: '최근 N일 (rolling, now − N×24h). 1~365, 미지정 시 전체 기간',
  })
  @ApiResponse({ status: 200, type: PutawayPendingListDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listPutawayPending(
    @Query('warehouseId') warehouseId?: string,
    @Query('days') days?: string,
  ): Promise<PutawayPendingListDto> {
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    // parseInt 는 '12abc' → 12, '1e21' → 1 처럼 숫자 아닌 접미사를 조용히 잘라먹는다
    // — 순수 숫자 문자열만 허용해 그런 입력을 정직하게 400 으로 거절한다.
    if (days !== undefined && !/^\d+$/.test(days)) {
      throw new BadRequestException('days must be a positive integer between 1 and 365');
    }
    const parsedDays = days === undefined ? undefined : parseInt(days, 10);
    if (parsedDays !== undefined && (parsedDays < 1 || parsedDays > 365)) {
      throw new BadRequestException('days must be a positive integer between 1 and 365');
    }
    return this.putawayReader.listPending({ warehouseId, days: parsedDays });
  }

  @Post('putaway')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 적치(즉시 이동): 원위치에서 목적지로 즉시 이동' })
  @ApiResponse({ status: 201, description: '적치가 성공적으로 처리되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async putaway(@Body() dto: PutawayRequestDto) {
    return this.inboundService.putawayFromOrigin(dto);
  }

  @Post('return')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 회송: 원위치 잔량에서 차감' })
  @ApiResponse({ status: 201, description: '회송이 성공적으로 처리되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async returnInbound(@Body() dto: ReturnInboundDto) {
    return this.inboundService.returnInbound(dto);
  }

  @Post('cancel')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 취소: 오입고 정정, 원위치 잔량에서 차감' })
  @ApiResponse({ status: 201, description: '입고취소가 성공적으로 처리되었습니다.' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async cancelInbound(@Body() dto: CancelInboundDto) {
    return this.inboundService.cancelInbound(dto);
  }

  // 예정 CRUD 및 연계
  @Post('plans')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '입고예정 생성' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createPlan(@Body() dto: CreateInboundPlanDto) {
    return this.inboundService.createInboundPlan(dto);
  }

  @Post('plans/items')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '입고예정 아이템 추가' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async addPlanItems(@Body() dto: AddInboundPlanItemsDto) {
    return this.inboundService.addInboundPlanItems(dto);
  }

  @Get('plans/items')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고예정 아이템 조회(헤더 무시, 아이템 기준)' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listPlanItems(@Query() query: ListPlanItemsQueryDto) {
    return this.inboundService.listInboundPlanItems(query);
  }

  @Post('plans/receive')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고예정 아이템 기반 실입고 처리' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async receiveFromPlan(@Body() dto: ReceiveFromPlanDto) {
    return this.inboundService.receiveFromPlan(dto);
  }
}
