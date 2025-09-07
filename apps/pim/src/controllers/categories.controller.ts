import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '@app/shared';
import { ProductCategoriesService } from '../services/categories.service';
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../schemas/categories';
import {
  CategoryResponseDto,
  CategoryDetailResponseDto,
  CategoryTreeResponseDto,
  CategoryPathResponseDto,
} from '../types/categories';

@Controller('categories')
export class ProductCategoriesController {
  constructor(
    private readonly productCategoriesService: ProductCategoriesService,
  ) {}

  @Post()
  async createCategory(
    @Body(new ZodValidationPipe(CreateCategorySchema))
    createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.createCategory(createCategoryDto);
  }

  @Put(':id')
  async updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema))
    updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.updateCategory(id, updateCategoryDto);
  }

  @Delete(':id')
  async deleteCategory(
    @Param('id') id: string,
    @Query('moveProductsTo') moveProductsTo?: string,
  ): Promise<void> {
    return this.productCategoriesService.deleteCategory(id, moveProductsTo);
  }

  @Get(':id')
  async getCategoryById(
    @Param('id') id: string,
  ): Promise<CategoryDetailResponseDto> {
    return this.productCategoriesService.getCategoryById(id);
  }

  @Get()
  async getCategoryTree(
    @Query('maxDepth') maxDepth?: number,
  ): Promise<CategoryTreeResponseDto> {
    return this.productCategoriesService.getCategoryTree(maxDepth);
  }

  @Get(':id/children')
  async getChildCategories(
    @Param('id') id: string,
  ): Promise<CategoryResponseDto[]> {
    return this.productCategoriesService.getChildCategories(id);
  }

  @Get(':id/path')
  async getCategoryPath(
    @Param('id') id: string,
  ): Promise<CategoryPathResponseDto> {
    return this.productCategoriesService.getCategoryPath(id);
  }

  @Put(':id/move')
  async moveCategory(
    @Param('id') id: string,
    @Query('newParentId') newParentId?: string,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.moveCategory(id, newParentId);
  }
}
