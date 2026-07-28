import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { WarehouseDto } from '../dto/warehouse.dto';
import { WarehouseMapper } from '../mappers/warehouse.mapper';
import { WarehouseService } from '../services/warehouse.service';

@ApiTags('Inventory')
@Controller('inventory/warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  @ApiOperation({ summary: '새 창고 생성' })
  @ApiResponse({ status: 201, description: '창고가 생성되었습니다.', type: WarehouseDto })
  async create(@Body() dto: CreateWarehouseDto): Promise<WarehouseDto> {
    const warehouse = await this.warehouseService.create(dto);
    return WarehouseMapper.toDto(warehouse);
  }

  @Get()
  @ApiOperation({ summary: '모든 창고 목록 조회' })
  @ApiResponse({ status: 200, description: '창고 목록을 반환합니다.' })
  async findAll(): Promise<WarehouseDto[]> {
    const warehouses = await this.warehouseService.findAll();
    return warehouses.map((w) => WarehouseMapper.toDto(w));
  }

  @Get(':id')
  @ApiOperation({ summary: '특정 창고 조회' })
  @ApiResponse({ status: 200, description: '창고 정보를 반환합니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  async findOne(@Param('id') id: string) {
    return this.warehouseService.findOne(id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: '창고별 재고 요약 조회' })
  @ApiResponse({ status: 200, description: '창고별 재고 요약을 반환합니다.' })
  async getStockSummary(@Param('id') id: string) {
    return this.warehouseService.getStockSummary(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '창고 정보 수정' })
  @ApiResponse({ status: 200, description: '창고 정보가 수정되었습니다.', type: WarehouseDto })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  async update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto): Promise<WarehouseDto> {
    // 매퍼를 태우는 이유: 이 메서드만 raw 엔티티를 반환해 create/findAll 과 응답 형태가
    // 달랐다. 매퍼가 supportedPickingStrategies 의 null 을 [] 로 정규화하므로
    // (warehouse.mapper.ts:11), 이제 세 메서드 모두 같은 형태의 응답을 반환한다.
    const warehouse = await this.warehouseService.update(id, dto);
    return WarehouseMapper.toDto(warehouse);
  }

  @Delete(':id')
  @ApiOperation({ summary: '창고 삭제' })
  @ApiResponse({ status: 200, description: '창고가 삭제되었습니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  @ApiResponse({ status: 409, description: '기본 창고이거나 사용 중인 창고는 삭제할 수 없습니다.' })
  async remove(@Param('id') id: string) {
    return this.warehouseService.remove(id);
  }
}
