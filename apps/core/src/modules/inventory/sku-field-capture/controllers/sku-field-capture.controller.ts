import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import type { WarehouseActor } from '../../core/services/warehouse-operation-contract';
import { SkuFieldCaptureService } from '../services/sku-field-capture.service';
import { fieldCaptureActorOf } from '../sku-field-capture.rules';
import { AttachReferencePhotoDto } from '../dto/attach-reference-photo.dto';
import { CompleteFieldCaptureDto } from '../dto/complete-field-capture.dto';
import {
  FieldCaptureDetailDto,
  FieldCaptureListQueryDto,
  FieldCaptureProgressDto,
  MyTodayDto,
  MyCaptureItemsDto,
  ShelfPositionDto,
} from '../dto/sku-field-capture.dto';

type CaptureUser = NonNullable<WarehouseActor> & { email?: string; login_id?: string; name?: string };

@ApiTags('Inventory')
@Controller('inventory/sku-field-capture')
@UseGuards(ScopeGuard)
export class SkuFieldCaptureController {
  constructor(private readonly service: SkuFieldCaptureService) {}

  @RequirePermission('inventory.master.read')
  @Get('progress')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 실측 작업 현황(관리자)' })
  @ApiResponse({ status: 200, type: FieldCaptureProgressDto })
  getProgress(): Promise<FieldCaptureProgressDto> {
    return this.service.getProgress();
  }

  @RequirePermission('inventory.stock.read')
  @Get('me/today')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '내가 오늘 끝낸 SKU 수(작업자 본인)' })
  @ApiResponse({ status: 200, type: MyTodayDto })
  getMyToday(@User() user: CaptureUser): Promise<MyTodayDto> {
    return this.service.getMyToday(fieldCaptureActorOf(user));
  }

  @RequirePermission('inventory.stock.read')
  @Get('items')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '작업 기록 목록, 최근순 — 내 것/전체 · 기간(KST) · 상품명·코드·선반 검색' })
  @ApiResponse({ status: 200, type: MyCaptureItemsDto })
  listItems(@Query() query: FieldCaptureListQueryDto, @User() user: CaptureUser): Promise<MyCaptureItemsDto> {
    const q = query.q?.trim();
    return this.service.listItems(
      { who: query.who ?? 'mine', from: query.from, to: query.to, q: q || undefined },
      fieldCaptureActorOf(user),
    );
  }

  @RequirePermission('inventory.stock.read')
  @Get('positions/:positionCode')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '선반 위치 코드로 SKU 목록 조회' })
  @ApiResponse({ status: 200, type: ShelfPositionDto })
  findByPosition(@Param('positionCode') positionCode: string): Promise<ShelfPositionDto> {
    return this.service.findByPosition(positionCode);
  }

  @RequirePermission('inventory.stock.read')
  @Get('skus/:skuId')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: 'SKU 실측 상세' })
  @ApiResponse({ status: 200, type: FieldCaptureDetailDto })
  getDetail(@Param('skuId', ParseUUIDPipe) skuId: string): Promise<FieldCaptureDetailDto> {
    return this.service.getDetail(skuId);
  }

  @RequirePermission('inventory.stock.read')
  @Get('barcodes/:barcode/owner')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '바코드를 가진 SKU 조회' })
  findBarcodeOwner(@Param('barcode') barcode: string) {
    return this.service.findBarcodeOwner(barcode);
  }

  @RequirePermission('inventory.stock.operate')
  @Post('skus/:skuId/photos')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '실물 사진 연결' })
  @ApiResponse({ status: 201, type: FieldCaptureDetailDto })
  attachPhoto(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: AttachReferencePhotoDto,
    @User() user: CaptureUser,
  ): Promise<FieldCaptureDetailDto> {
    return this.service.attachPhoto(skuId, dto.fileId, fieldCaptureActorOf(user));
  }

  @RequirePermission('inventory.stock.operate')
  @Delete('skus/:skuId/photos/:photoId')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '실물 사진 연결 해제' })
  @ApiResponse({ status: 200, type: FieldCaptureDetailDto })
  removePhoto(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<FieldCaptureDetailDto> {
    return this.service.removePhoto(skuId, photoId);
  }

  @RequirePermission('inventory.stock.operate')
  @Put('skus/:skuId/capture')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '실측 완료 처리' })
  @ApiResponse({ status: 200, type: FieldCaptureDetailDto })
  complete(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: CompleteFieldCaptureDto,
    @User() user: CaptureUser,
  ): Promise<FieldCaptureDetailDto> {
    return this.service.complete(skuId, dto, fieldCaptureActorOf(user));
  }

  @RequirePermission('inventory.stock.operate')
  @Delete('skus/:skuId/capture')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '실측 완료 취소(내가 마지막으로 끝낸 상품만)' })
  @ApiResponse({ status: 204 })
  cancel(@Param('skuId', ParseUUIDPipe) skuId: string, @User() user: CaptureUser): Promise<void> {
    return this.service.cancel(skuId, fieldCaptureActorOf(user));
  }
}
