import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import {
  WarehouseActor,
  authenticatedWarehouseActor,
  warehouseOperationContext,
} from '../../core/services/warehouse-operation-contract';
import { InboundShipmentService } from '../services/inbound-shipment.service';
import { UploadInboundShipmentDto } from '../dto/upload.dto';
import {
  CloseInboundShipmentDto,
  EditBoxDto,
  EditLineDto,
  SetAiCandidatesDto,
  UpdateHeaderDto,
} from '../dto/draft-edit.dto';
import {
  AddInboundShipmentBoxDto,
  AddInboundShipmentBoxResultDto,
  BoxViewDto,
  CancelBoxReceiptDto,
  CancelBoxReceiptResultDto,
  ReceiveBoxDto,
  ReceiveBoxResultDto,
} from '../dto/receive.dto';
import {
  INBOUND_SHIPMENT_STATUSES,
  InboundShipmentDetailViewDto,
  InboundShipmentStatusValue,
  InboundShipmentSummaryDto,
} from '../dto/inbound-shipment-view.dto';

const isStatus = (v: string): v is InboundShipmentStatusValue =>
  (INBOUND_SHIPMENT_STATUSES as readonly string[]).includes(v);

@ApiTags('Inbound Shipments')
@Controller('inventory/inbound-shipments')
export class InboundShipmentController {
  constructor(private readonly service: InboundShipmentService) {}

  @RequirePermission('inventory.inbound_shipment.write')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '입고리스트를 올려 선적 초안 만들기' })
  @ApiResponse({ status: 201, description: '{ shipmentId }' })
  upload(@Body() dto: UploadInboundShipmentDto, @User() user: WarehouseActor): Promise<{ shipmentId: string }> {
    const actorId = authenticatedWarehouseActor(user);
    return this.service.createDraft(
      {
        warehouseId: dto.warehouseId,
        name: dto.name,
        expectedArrival: dto.expectedArrival ?? null,
        sourceFileId: dto.sourceFileId ?? null,
        sourceFileName: dto.sourceFileName,
        list: { header: dto.header, rows: dto.rows },
      },
      actorId,
    );
  }

  @RequirePermission('inventory.stock.read')
  @Get()
  @ApiOperation({ summary: '선적 목록' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'status', required: false, description: '쉼표로 여러 개' })
  @ApiResponse({ status: 200, type: [InboundShipmentSummaryDto] })
  list(
    @Query('warehouseId', new ParseUUIDPipe({ optional: true })) warehouseId?: string,
    @Query('status') status?: string,
  ): Promise<InboundShipmentSummaryDto[]> {
    const requested = status ? status.split(',').filter(Boolean) : [];
    const statuses = requested.filter(isStatus);
    if (statuses.length !== requested.length) throw new BadRequestError('status 값이 올바르지 않습니다.');
    return this.service.list({ warehouseId, status: statuses.length > 0 ? statuses : undefined });
  }

  @RequirePermission('inventory.stock.read')
  @Get(':id')
  @ApiOperation({ summary: '선적 상세' })
  @ApiResponse({ status: 200, type: InboundShipmentDetailViewDto })
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<InboundShipmentDetailViewDto> {
    return this.service.detail(id);
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Patch(':id')
  @ApiOperation({ summary: '선적 머리(이름·도착 예정일·메모) 고치기' })
  async updateHeader(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateHeaderDto,
  ): Promise<{ shipmentId: string }> {
    await this.service.updateHeader(id, { name: dto.name, expectedArrival: dto.expectedArrival, memo: dto.memo });
    return { shipmentId: id };
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Patch(':id/lines/:lineId')
  @ApiOperation({ summary: '줄을 사람이 확정하거나 고치기' })
  async editLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: EditLineDto,
    @User() user: WarehouseActor,
  ): Promise<{ lineId: string }> {
    const actorId = authenticatedWarehouseActor(user);
    if (dto.kind === 'sku' && !dto.skuId) throw new BadRequestError('skuId is required');
    if (dto.kind === undefined && dto.expectedQty === undefined && dto.boxLabels === undefined) {
      throw new BadRequestError('kind, expectedQty, boxLabels 중 하나는 있어야 합니다.');
    }
    // kind 를 빼면 종류·SKU·확정 방식은 그대로 두고 수량·상자만 고친다
    const patch =
      dto.kind === undefined
        ? null
        : dto.kind === 'sku' && dto.skuId
          ? { kind: 'sku' as const, skuId: dto.skuId }
          : { kind: 'free' as const };
    await this.service.editLine(id, lineId, patch, { expectedQty: dto.expectedQty, boxLabels: dto.boxLabels }, actorId);
    return { lineId };
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Patch(':id/boxes/:boxId')
  @ApiOperation({ summary: '상자의 입고/전달 구분·메모·이름 고치기' })
  async editBox(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('boxId', new ParseUUIDPipe()) boxId: string,
    @Body() dto: EditBoxDto,
    @User() user: WarehouseActor,
  ): Promise<{ boxId: string }> {
    const actorId = authenticatedWarehouseActor(user);
    await this.service.editBox(
      id,
      boxId,
      { disposition: dto.disposition, forwardNote: dto.forwardNote, label: dto.label },
      actorId,
    );
    return { boxId };
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Put(':id/lines/:lineId/ai-candidates')
  @ApiOperation({ summary: 'AI 후보 적기 — 줄을 확정하지 않는다' })
  async setAiCandidates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: SetAiCandidatesDto,
  ): Promise<{ lineId: string }> {
    await this.service.setAiCandidates(id, lineId, dto.candidates);
    return { lineId };
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '초안 확정 — 막는 줄·상자가 있으면 409' })
  @ApiResponse({ status: 200, description: '{ shipmentId, status, labelOverlaps }' })
  confirm(@Param('id', new ParseUUIDPipe()) id: string, @User() user: WarehouseActor) {
    return this.service.confirm(id, authenticatedWarehouseActor(user));
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '선적 취소 — 초안이거나 받은 상자가 없을 때만' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @User() user: WarehouseActor) {
    return this.service.cancel(id, authenticatedWarehouseActor(user));
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '선적 끝내기 — 상자가 안 왔는데 끝낼 때(사유 필수). 남은 상자는 확정만 막힌다' })
  @ApiResponse({ status: 200, description: '{ shipmentId, status }' })
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CloseInboundShipmentDto,
    @User() user: WarehouseActor,
  ) {
    return this.service.close(id, dto.reason, authenticatedWarehouseActor(user));
  }

  @RequirePermission('inventory.inbound_shipment.write')
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '사람이 끝낸 선적 다시 열기 — 저절로 끝난 선적은 409' })
  @ApiResponse({ status: 200, description: '{ shipmentId, status }' })
  reopen(@Param('id', new ParseUUIDPipe()) id: string, @User() user: WarehouseActor) {
    return this.service.reopen(id, authenticatedWarehouseActor(user));
  }

  @RequirePermission('inventory.stock.read')
  @Get(':id/boxes/:boxId')
  @ApiOperation({ summary: '상자 열기 — 그 상자를 덮는 줄과 다른 상자에서 이미 센 수량' })
  @ApiResponse({ status: 200, type: BoxViewDto })
  openBox(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('boxId', new ParseUUIDPipe()) boxId: string,
  ): Promise<BoxViewDto> {
    return this.service.openBox(id, boxId);
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/boxes/:boxId/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '상자 확정 — 센 만큼 입고(창고 작업 계약 v2)' })
  @ApiResponse({ status: 200, type: ReceiveBoxResultDto })
  receiveBox(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('boxId', new ParseUUIDPipe()) boxId: string,
    @Body() dto: ReceiveBoxDto,
    @User() user: WarehouseActor,
  ): Promise<ReceiveBoxResultDto> {
    const actorId = warehouseOperationContext(dto, user);
    // v2 만 받는다 — v1(키 없음)로 내려오면 멱등 키 없이 원장에 쓰게 되므로 여기서 막는다
    if (!actorId) throw new BadRequestError('창고 작업 계약 v2(contractVersion: 2, idempotencyKey)가 필요합니다.');
    return this.service.receiveBox(id, boxId, dto, actorId);
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/boxes/:boxId/receive/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '상자 확정 취소 — 당일·전량, 적치 전만(창고 작업 계약 v2)' })
  @ApiResponse({ status: 200, type: CancelBoxReceiptResultDto })
  cancelBoxReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('boxId', new ParseUUIDPipe()) boxId: string,
    @Body() dto: CancelBoxReceiptDto,
    @User() user: WarehouseActor,
  ): Promise<CancelBoxReceiptResultDto> {
    const actorId = warehouseOperationContext(dto, user);
    // v2 만 받는다 — v1(키 없음)로 내려오면 멱등 키 없이 원장을 되돌리게 되므로 여기서 막는다
    if (!actorId) throw new BadRequestError('창고 작업 계약 v2(contractVersion: 2, idempotencyKey)가 필요합니다.');
    return this.service.cancelBoxReceipt(id, boxId, dto, actorId);
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/boxes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '리스트에 없던 상자로 받기 — 확정된 선적에만(창고 작업 계약 v2)' })
  @ApiResponse({ status: 201, type: AddInboundShipmentBoxResultDto })
  addBox(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddInboundShipmentBoxDto,
    @User() user: WarehouseActor,
  ): Promise<AddInboundShipmentBoxResultDto> {
    const actorId = warehouseOperationContext(dto, user);
    // v2 만 받는다 — v1(키 없음)로 내려오면 재시도가 상자를 둘 만들 수 있으므로 여기서 막는다
    if (!actorId) throw new BadRequestError('창고 작업 계약 v2(contractVersion: 2, idempotencyKey)가 필요합니다.');
    return this.service.addBox(id, dto, actorId);
  }
}
