import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkuGroupService } from '../services/sku-group.service';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/manage-group-members.dto';
import { BulkAddSkusResponseDto, SkuGroupMembersResponseDto, SkuGroupResponseDto } from '../dto/sku-group-response.dto';

class UngroupedQueryDto {
  @ApiProperty({ description: '조회 개수 (Limit)', required: false, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @ApiProperty({ description: '페이지 오프셋 (Offset)', required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

@ApiTags('SKU Groups')
@Controller('inventory/sku-groups')
export class SkuGroupController {
  constructor(private readonly skuGroupService: SkuGroupService) {}

  @Post()
  @ApiOperation({ summary: 'SKU 그룹 생성 (Create SKU group)' })
  @ApiResponse({
    status: 201,
    description: '그룹이 성공적으로 생성되었습니다. (Group created successfully)',
    type: SkuGroupResponseDto,
  })
  @ApiResponse({ status: 409, description: '그룹 코드가 이미 존재합니다. (Group code already exists)' })
  async create(@Body() dto: CreateSkuGroupDto): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '모든 SKU 그룹 조회 (List all SKU groups)' })
  @ApiResponse({ status: 200, description: 'SKU 그룹 목록', type: [SkuGroupResponseDto] })
  async list(): Promise<SkuGroupResponseDto[]> {
    return this.skuGroupService.list();
  }

  @Get('ungrouped')
  @ApiOperation({ summary: '그룹에 속하지 않은 SKU 조회 (Get ungrouped SKUs)' })
  @ApiResponse({ status: 200, description: '그룹 미지정 SKU 목록' })
  async getUngroupedSkus(@Query() query: UngroupedQueryDto) {
    return this.skuGroupService.getUngroupedSkus(query.limit ?? 50, query.offset ?? 0);
  }

  @Get(':id')
  @ApiOperation({ summary: 'SKU 그룹 상세 조회' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: '그룹 상세 정보', type: SkuGroupResponseDto })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
  async getById(@Param('id') groupId: string): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.getById(groupId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'SKU 그룹 수정' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: '그룹이 수정되었습니다.', type: SkuGroupResponseDto })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
  async update(@Param('id') groupId: string, @Body() dto: UpdateSkuGroupDto): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.update(groupId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU 그룹 삭제' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 204, description: '그룹이 삭제되었습니다. 멤버 SKU들은 그룹에서 해제됩니다.' })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
  async remove(@Param('id') groupId: string): Promise<void> {
    return this.skuGroupService.remove(groupId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: '그룹의 모든 SKU 조회' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: '그룹 멤버 목록', type: SkuGroupMembersResponseDto })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
  async getMembers(@Param('id') groupId: string): Promise<SkuGroupMembersResponseDto> {
    return this.skuGroupService.getMembers(groupId);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'SKU를 그룹에 추가' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: 'SKU가 그룹에 추가되었습니다.' })
  @ApiResponse({ status: 404, description: 'SKU 또는 그룹을 찾을 수 없습니다.' })
  async addSku(@Param('id') groupId: string, @Body() dto: AddSkuToGroupDto) {
    return this.skuGroupService.addSku(groupId, dto);
  }

  @Post(':id/members/bulk')
  @ApiOperation({ summary: '여러 SKU를 그룹에 일괄 추가' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: '일괄 추가가 완료되었습니다.', type: BulkAddSkusResponseDto })
  async bulkAddSkus(@Param('id') groupId: string, @Body() dto: BulkAddSkusToGroupDto): Promise<BulkAddSkusResponseDto> {
    return this.skuGroupService.bulkAddSkus(groupId, dto);
  }

  @Delete('members/:skuId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU를 그룹에서 제거' })
  @ApiParam({ name: 'skuId', description: 'SKU ID to remove from group' })
  @ApiResponse({ status: 204, description: 'SKU가 그룹에서 제거되었습니다.' })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async removeSku(@Param('skuId') skuId: string): Promise<void> {
    await this.skuGroupService.removeSku(skuId);
  }
}
