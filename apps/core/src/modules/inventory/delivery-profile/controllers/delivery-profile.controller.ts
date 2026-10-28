import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileService } from '../services/delivery-profile.service';

@ApiTags('Inventory')
@Controller('inventory/delivery-profiles')
export class DeliveryProfileController {
  constructor(private readonly service: DeliveryProfileService) {}

  @RequirePermission('inventory.stock.read')
  @Get()
  @ApiOperation({ summary: '배송 프로필 목록 (연결 SKU 수 포함)' })
  @ApiResponse({ status: 200, type: DeliveryProfileDto, isArray: true })
  findAll(): Promise<DeliveryProfileDto[]> {
    return this.service.findAll();
  }

  @RequirePermission('inventory.stock.read')
  @Get(':id')
  @ApiOperation({ summary: '배송 프로필 조회' })
  @ApiResponse({ status: 404, description: '배송 프로필을 찾을 수 없습니다.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DeliveryProfileDto> {
    return this.service.findOne(id);
  }

  @RequirePermission('inventory.master.write')
  @Post()
  @ApiOperation({ summary: '배송 프로필 생성 — 계획 확정이 요구하는 필드를 전부 받는다' })
  @ApiResponse({ status: 201, type: DeliveryProfileDto })
  create(@Body() dto: CreateDeliveryProfileDto): Promise<DeliveryProfileDto> {
    return this.service.create(dto);
  }

  @RequirePermission('inventory.master.write')
  @Patch(':id')
  @ApiOperation({ summary: '배송 프로필 수정 — 중첩 객체는 통째로 보낸다' })
  @ApiResponse({ status: 404, description: '배송 프로필을 찾을 수 없습니다.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryProfileDto): Promise<DeliveryProfileDto> {
    return this.service.update(id, dto);
  }
}
