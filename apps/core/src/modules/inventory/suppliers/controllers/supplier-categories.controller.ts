import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { SupplierCategoriesService } from '../services/supplier-categories.service';
import { CreateSupplierCategoryDto, UpdateSupplierCategoryDto, SupplierCategoryResponseDto } from '../dto';

@ApiTags('Supplier Categories')
@Controller('supplier-categories')
export class SupplierCategoriesController {
  constructor(private readonly supplierCategoriesService: SupplierCategoriesService) {}

  @RequirePermission('inventory.master.read')
  @Get()
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

  @RequirePermission('inventory.master.read')
  @Get(':id')
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

  @RequirePermission('inventory.master.write')
  @Post()
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

  @RequirePermission('inventory.master.write')
  @Put(':id')
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

  @RequirePermission('inventory.master.write')
  @Delete(':id')
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
