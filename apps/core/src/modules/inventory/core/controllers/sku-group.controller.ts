import { Controller, Post, Get, Put, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SkuGroupService } from '../services/sku-group.service';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/sku-groups/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/sku-groups/manage-group-members.dto';
import {
  SkuGroupResponseDto,
  SkuGroupMembersResponseDto,
  BulkAddSkusResponseDto,
} from '../dto/sku-groups/sku-group-response.dto';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
  async createSkuGroup(@Body() createDto: CreateSkuGroupDto): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.createSkuGroup(createDto);
  }

  @Get()
  @ApiOperation({ summary: '모든 SKU 그룹 조회 (List all SKU groups)' })
  @ApiResponse({
    status: 200,
    description: 'SKU 그룹 목록 (List of SKU groups)',
    type: [SkuGroupResponseDto],
  })
  async listSkuGroups(): Promise<SkuGroupResponseDto[]> {
    return this.skuGroupService.listSkuGroups();
  }

  @Get('ungrouped')
  @ApiOperation({ summary: '그룹에 속하지 않은 SKU 조회 (Get ungrouped SKUs)' })
  @ApiResponse({
    status: 200,
    description: '그룹 미지정 SKU 목록 (List of ungrouped SKUs)',
  })
  async getUngroupedSkus(@Query() query: UngroupedQueryDto): Promise<any[]> {
    return this.skuGroupService.getUngroupedSkus(query.limit ?? 50, query.offset ?? 0);
  }

  @Get(':id')
  @ApiOperation({ summary: 'SKU 그룹 상세 조회 (Get SKU group detail)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: '그룹 상세 정보 (Group details)',
    type: SkuGroupResponseDto,
  })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다. (Group not found)' })
  async getSkuGroup(@Param('id') groupId: string): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.getSkuGroupById(groupId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'SKU 그룹 수정 (Update SKU group)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: '그룹이 수정되었습니다. (Group updated successfully)',
    type: SkuGroupResponseDto,
  })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다. (Group not found)' })
  async updateSkuGroup(
    @Param('id') groupId: string,
    @Body() updateDto: UpdateSkuGroupDto,
  ): Promise<SkuGroupResponseDto> {
    return this.skuGroupService.updateSkuGroup(groupId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU 그룹 삭제 (Delete SKU group)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 204,
    description: '그룹이 삭제되었습니다. 멤버 SKU들은 그룹에서 해제됩니다. (Group deleted, member SKUs are ungrouped)',
  })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다. (Group not found)' })
  async deleteSkuGroup(@Param('id') groupId: string): Promise<void> {
    return this.skuGroupService.deleteSkuGroup(groupId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: '그룹의 모든 SKU 조회 (Get all SKUs in group)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: '그룹 멤버 목록 (Group members list)',
    type: SkuGroupMembersResponseDto,
  })
  @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다. (Group not found)' })
  async getGroupMembers(@Param('id') groupId: string): Promise<SkuGroupMembersResponseDto> {
    return this.skuGroupService.getGroupMembers(groupId);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'SKU를 그룹에 추가 (Add SKU to group)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: 'SKU가 그룹에 추가되었습니다. (SKU added to group successfully)',
  })
  @ApiResponse({ status: 404, description: 'SKU 또는 그룹을 찾을 수 없습니다. (SKU or group not found)' })
  async addSkuToGroup(
    @Param('id') groupId: string,
    @Body() addDto: AddSkuToGroupDto,
  ): Promise<{ success: boolean; skuId: string; groupId: string }> {
    return this.skuGroupService.addSkuToGroup(groupId, addDto);
  }

  @Post(':id/members/bulk')
  @ApiOperation({ summary: '여러 SKU를 그룹에 일괄 추가 (Bulk add SKUs to group)' })
  @ApiParam({ name: 'id', description: 'Group ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: '일괄 추가가 완료되었습니다. (Bulk add completed)',
    type: BulkAddSkusResponseDto,
  })
  async bulkAddSkusToGroup(
    @Param('id') groupId: string,
    @Body() bulkDto: BulkAddSkusToGroupDto,
  ): Promise<BulkAddSkusResponseDto> {
    return this.skuGroupService.bulkAddSkusToGroup(groupId, bulkDto);
  }

  @Delete('members/:skuId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU를 그룹에서 제거 (Remove SKU from group)' })
  @ApiParam({
    name: 'skuId',
    description: 'SKU ID to remove from group',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'SKU가 그룹에서 제거되었습니다. (SKU removed from group)',
  })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다. (SKU not found)' })
  async removeSkuFromGroup(@Param('skuId') skuId: string): Promise<void> {
    await this.skuGroupService.removeSkuFromGroup(skuId);
  }
}
