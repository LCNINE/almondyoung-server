import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { HolderService } from '../services/holder.service';
import { HolderQueryDto } from '../dto/holder/holder-query.dto';
import { CreateHolderDto } from '../dto/holder/holder-create.dto';
import { UpdateHolderDto } from '../dto/holder/holder-update.dto';
import { HolderDto, HolderListResponseDto } from '../dto/holder/holder-response.dto';

@ApiTags('Holder Management')
@Controller('holders')
@UseGuards(ScopeGuard)
export class HolderController {
  private readonly logger = new Logger(HolderController.name);

  constructor(private readonly holderService: HolderService) {}

  @Get()
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고소유 목록/검색 조회' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '재고소유 목록이 성공적으로 조회되었습니다.',
    type: HolderListResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listHolders(@Query() query: HolderQueryDto): Promise<HolderListResponseDto> {
    this.logger.log(`Listing holders with filters: ${JSON.stringify(query)}`);
    return await this.holderService.listHolders(query);
  }

  @Get(':id')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고소유 단일 조회' })
  @ApiParam({ name: 'id', description: 'Holder ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '재고소유가 성공적으로 조회되었습니다.',
    type: HolderDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '재고소유를 찾을 수 없습니다.',
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getHolderById(@Param('id') id: string): Promise<HolderDto> {
    this.logger.log(`Getting holder by id: ${id}`);
    return await this.holderService.getHolderById(id);
  }

  @Post()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '재고소유 생성' })
  @ApiBody({ type: CreateHolderDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '재고소유가 성공적으로 생성되었습니다.',
    type: HolderDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (중복된 이름 등)',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createHolder(@Body() dto: CreateHolderDto): Promise<HolderDto> {
    this.logger.log(`Creating holder: ${dto.name}`);
    return await this.holderService.createHolder(dto);
  }

  @Put(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '재고소유 수정' })
  @ApiParam({ name: 'id', description: 'Holder ID' })
  @ApiBody({ type: UpdateHolderDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '재고소유가 성공적으로 수정되었습니다.',
    type: HolderDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '재고소유를 찾을 수 없습니다.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (중복된 이름 등)',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async updateHolder(@Param('id') id: string, @Body() dto: UpdateHolderDto): Promise<HolderDto> {
    this.logger.log(`Updating holder: ${id}`);
    return await this.holderService.updateHolder(id, dto);
  }

  @Delete(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '재고소유 삭제' })
  @ApiParam({ name: 'id', description: 'Holder ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '재고소유가 성공적으로 삭제되었습니다.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '재고소유를 찾을 수 없습니다.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '연결된 SKU 또는 주문이 있어 삭제할 수 없습니다.',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async deleteHolder(@Param('id') id: string): Promise<{ success: boolean }> {
    this.logger.log(`Deleting holder: ${id}`);
    return await this.holderService.deleteHolder(id);
  }
}
