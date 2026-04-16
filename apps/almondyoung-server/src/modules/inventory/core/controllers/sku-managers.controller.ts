import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SkuManagersService } from '../services/sku-managers.service';
import { CreateSkuManagersDto } from '../dto/sku-managers/create-sku-managers.dto';
import { UpdateSkuManagersDto } from '../dto/sku-managers/update-sku-managers.dto';
import { SkuManagersResponseDto } from '../dto/sku-managers/sku-managers-response.dto';

@ApiTags('SKU Managers')
@Controller('inventory/skus')
export class SkuManagersController {
  constructor(private readonly skuManagersService: SkuManagersService) {}

  @Post('managers')
  @ApiOperation({
    summary: 'SKU 담당자 할당 (Assign managers to SKU)',
    description: 'Create or update manager assignments for a SKU',
  })
  @ApiResponse({
    status: 201,
    description: 'Managers assigned successfully',
    type: SkuManagersResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'SKU not found' })
  async assignManagers(@Body() dto: CreateSkuManagersDto): Promise<SkuManagersResponseDto> {
    return this.skuManagersService.assignManagers(dto);
  }

  @Get(':skuId/managers')
  @ApiOperation({
    summary: 'SKU 담당자 조회 (Get managers for SKU)',
    description: 'Get manager assignments for a specific SKU',
  })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'Managers retrieved successfully',
    type: SkuManagersResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Managers not found' })
  async getManagers(@Param('skuId') skuId: string): Promise<SkuManagersResponseDto | null> {
    return this.skuManagersService.getManagersBySkuId(skuId);
  }

  @Put(':skuId/managers')
  @ApiOperation({
    summary: 'SKU 담당자 수정 (Update managers for SKU)',
    description: 'Update manager assignments for a SKU (partial update supported)',
  })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'Managers updated successfully',
    type: SkuManagersResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Managers not found' })
  async updateManagers(
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuManagersDto,
  ): Promise<SkuManagersResponseDto> {
    return this.skuManagersService.updateManagers(skuId, dto);
  }

  @Delete(':skuId/managers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SKU 담당자 제거 (Remove all managers from SKU)',
    description: 'Remove all manager assignments from a SKU',
  })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'Managers removed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Managers removed successfully' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Managers not found' })
  async removeManagers(@Param('skuId') skuId: string): Promise<{ success: boolean; message: string }> {
    return this.skuManagersService.removeManagers(skuId);
  }

  @Delete(':skuId/managers/:role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '특정 담당자 역할 제거 (Remove specific manager role)',
    description: 'Remove a specific manager role (designer, purchaseManager, or registrationManager)',
  })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({
    name: 'role',
    description: 'Manager role to remove',
    enum: ['designer', 'purchaseManager', 'registrationManager'],
  })
  @ApiResponse({
    status: 200,
    description: 'Manager role removed successfully',
    type: SkuManagersResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Managers not found' })
  async removeManagerRole(
    @Param('skuId') skuId: string,
    @Param('role') role: 'designer' | 'purchaseManager' | 'registrationManager',
  ): Promise<SkuManagersResponseDto> {
    return this.skuManagersService.removeManagerRole(skuId, role);
  }

  @Get('managers/all')
  @ApiOperation({
    summary: '전체 담당자 할당 조회 (Get all manager assignments)',
    description: 'Get all SKU manager assignments',
  })
  @ApiResponse({
    status: 200,
    description: 'All manager assignments retrieved successfully',
    type: [SkuManagersResponseDto],
  })
  async getAllManagerAssignments(): Promise<SkuManagersResponseDto[]> {
    return this.skuManagersService.getAllManagerAssignments();
  }
}

@ApiTags('Manager SKU Assignments')
@Controller('inventory/managers')
export class ManagerSkusController {
  constructor(private readonly skuManagersService: SkuManagersService) {}

  @Get(':managerId/skus')
  @ApiOperation({
    summary: '담당자별 SKU 목록 조회 (Get SKUs by manager)',
    description: 'Get all SKUs managed by a specific manager (any role)',
  })
  @ApiParam({ name: 'managerId', description: 'Manager ID' })
  @ApiResponse({
    status: 200,
    description: 'SKUs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skuId: { type: 'string' },
          role: {
            type: 'string',
            enum: ['designer', 'purchaseManager', 'registrationManager'],
          },
          assignedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async getSkusByManager(@Param('managerId') managerId: string): Promise<
    Array<{
      skuId: string;
      role: 'designer' | 'purchaseManager' | 'registrationManager';
      assignedAt: Date;
    }>
  > {
    return this.skuManagersService.getSkusByManagerId(managerId);
  }
}
