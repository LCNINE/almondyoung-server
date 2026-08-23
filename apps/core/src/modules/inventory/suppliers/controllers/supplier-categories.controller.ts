import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { SupplierCategoriesService } from '../services/supplier-categories.service';
import { CreateSupplierCategoryDto, UpdateSupplierCategoryDto, SupplierCategoryResponseDto } from '../dto';

@ApiTags('Supplier Categories')
@Controller('supplier-categories')
@UseGuards(ScopeGuard)
export class SupplierCategoriesController {
  constructor(private readonly supplierCategoriesService: SupplierCategoriesService) {}

  @Get()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'Get all supplier categories' })
  @ApiResponse({
    status: 200,
    description: 'List of supplier categories',
    type: [SupplierCategoryResponseDto],
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async getCategories(): Promise<SupplierCategoryResponseDto[]> {
    return this.supplierCategoriesService.getCategories();
  }

  @Get(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'Get supplier category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description: 'Category found',
    type: SupplierCategoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async getCategoryById(@Param('id') id: string): Promise<SupplierCategoryResponseDto> {
    return this.supplierCategoriesService.getCategoryById(id);
  }

  @Post()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'Create new supplier category' })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully',
    type: SupplierCategoryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createCategory(@Body() createDto: CreateSupplierCategoryDto): Promise<SupplierCategoryResponseDto> {
    return this.supplierCategoriesService.createCategory(createDto);
  }

  @Put(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'Update supplier category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
    type: SupplierCategoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async updateCategory(
    @Param('id') id: string,
    @Body() updateDto: UpdateSupplierCategoryDto,
  ): Promise<SupplierCategoryResponseDto> {
    return this.supplierCategoriesService.updateCategory(id, updateDto);
  }

  @Delete(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'Delete supplier category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 204,
    description: 'Category deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@Param('id') id: string): Promise<void> {
    return this.supplierCategoriesService.deleteCategory(id);
  }
}
