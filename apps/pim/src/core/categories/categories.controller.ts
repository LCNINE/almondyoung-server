import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ProductCategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryResponseDto,
  CategoryDetailResponseDto,
  CategoryTreeResponseDto,
  CategoryPathResponseDto,
  UpdateDisplaySettingsDto,
  UpdateSeoConfigDto,
  UpdateTemplateConfigDto,
  ReplaceTagGroupLinksDto,
  CategoryTagGroupsResponseDto,
} from './dto';

@ApiTags('Categories')
@Controller('categories')
export class ProductCategoriesController {
  constructor(
    private readonly productCategoriesService: ProductCategoriesService,
  ) { }

  @Post()
  @ApiOperation({
    summary: '카테고리 생성',
    description: '새로운 제품 카테고리를 생성합니다.',
  })
  @ApiBody({ type: CreateCategoryDto, description: '카테고리 생성 정보' })
  @ApiResponse({
    status: 201,
    description: '카테고리 생성 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 409, description: '이미 존재하는 카테고리명' })
  async createCategory(
    @Body() createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.createCategory(
      createCategoryDto,
    );
  }

  @Put(':id')
  @ApiOperation({
    summary: '카테고리 수정',
    description: '기존 카테고리 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiBody({ type: UpdateCategoryDto, description: '카테고리 수정 정보' })
  @ApiResponse({
    status: 200,
    description: '카테고리 수정 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  async updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.updateCategory(
      id,
      updateCategoryDto,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: '카테고리 삭제',
    description:
      '카테고리를 삭제합니다. 해당 카테고리의 제품들을 다른 카테고리로 이동할 수 있습니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 카테고리 ID' })
  @ApiQuery({
    name: 'moveProductsTo',
    required: false,
    description: '제품들을 이동시킬 대상 카테고리 ID',
  })
  @ApiResponse({ status: 200, description: '카테고리 삭제 성공' })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  @ApiResponse({
    status: 400,
    description: '하위 카테고리가 존재하여 삭제할 수 없음',
  })
  async deleteCategory(
    @Param('id') id: string,
    @Query('moveProductsTo') moveProductsTo?: string,
  ): Promise<void> {
    return this.productCategoriesService.deleteCategory(id, moveProductsTo);
  }

  @Get(':id')
  @ApiOperation({
    summary: '카테고리 상세 조회',
    description: '특정 카테고리의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '조회할 카테고리 ID' })
  @ApiResponse({
    status: 200,
    description: '카테고리 조회 성공',
    type: CategoryDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async getCategoryById(
    @Param('id') id: string,
  ): Promise<CategoryDetailResponseDto> {
    return this.productCategoriesService.getCategoryById(
      id,
    );
  }

  @Get()
  @ApiOperation({
    summary: '카테고리 트리 조회',
    description: '전체 카테고리를 계층구조로 조회합니다.',
  })
  @ApiQuery({
    name: 'maxDepth',
    required: false,
    type: Number,
    description: '조회할 최대 깊이 (미지정시 전체)',
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 트리 조회 성공',
    type: CategoryTreeResponseDto,
  })
  async getCategoryTree(
    @Query('maxDepth') maxDepth?: number,
  ): Promise<CategoryTreeResponseDto> {
    return this.productCategoriesService.getCategoryTree(maxDepth);
  }

  @Get(':id/children')
  @ApiOperation({
    summary: '하위 카테고리 조회',
    description: '특정 카테고리의 직계 하위 카테고리 목록을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '부모 카테고리 ID' })
  @ApiResponse({
    status: 200,
    description: '하위 카테고리 조회 성공',
    type: [CategoryResponseDto],
  })
  @ApiResponse({ status: 404, description: '부모 카테고리를 찾을 수 없음' })
  async getChildCategories(
    @Param('id') id: string,
  ): Promise<CategoryResponseDto[]> {
    return this.productCategoriesService.getChildCategories(
      id,
    );
  }

  @Get(':id/path')
  @ApiOperation({
    summary: '카테고리 경로 조회',
    description: '특정 카테고리의 루트부터의 전체 경로를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiResponse({
    status: 200,
    description: '카테고리 경로 조회 성공',
    type: CategoryPathResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async getCategoryPath(
    @Param('id') id: string,
  ): Promise<CategoryPathResponseDto> {
    return this.productCategoriesService.getCategoryPath(
      id,
    );
  }

  @Put(':id/move')
  @ApiOperation({
    summary: '카테고리 이동',
    description: '카테고리를 다른 부모 카테고리 하위로 이동시킵니다.',
  })
  @ApiParam({ name: 'id', description: '이동할 카테고리 ID' })
  @ApiQuery({
    name: 'newParentId',
    required: false,
    description: '새로운 부모 카테고리 ID (미지정시 루트로 이동)',
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 이동 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  @ApiResponse({
    status: 400,
    description: '순환 참조 또는 자기 자신으로 이동 시도',
  })
  async moveCategory(
    @Param('id') id: string,
    @Query('newParentId') newParentId?: string,
  ): Promise<CategoryResponseDto> {
    return this.productCategoriesService.moveCategory(
      id,
      newParentId,
    );
  }

  @Put(':id/products')
  @ApiOperation({
    summary: '상품들을 카테고리로 이동',
    description:
      '여러 상품을 특정 카테고리로 일괄 이동시킵니다. 기존 카테고리 관계는 삭제되고 새로운 카테고리로 대체됩니다.',
  })
  @ApiParam({ name: 'id', description: '대상 카테고리 ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        productIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: '이동시킬 상품 마스터 ID 배열',
          example: [
            '550e8400-e29b-41d4-a716-446655440000',
            '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          ],
        },
      },
      required: ['productIds'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '상품 이동 성공',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({
    status: 404,
    description: '카테고리 또는 상품을 찾을 수 없음',
  })
  async moveProductsToCategory(
    @Param('id') categoryId: string,
    @Body() body: { productIds: string[] },
  ): Promise<{ message: string; movedCount: number }> {
    try {
      if (!body.productIds || body.productIds.length === 0) {
        throw new HttpException(
          'productIds are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.productCategoriesService.moveProductsToCategory(
        body.productIds,
        categoryId,
      );

      return {
        message: 'Products moved successfully',
        movedCount: body.productIds.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to move products: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // 고지훈 추가 - 기존 카테고리 유지하면서 추가
  @Post(':id/products/add')
  @ApiOperation({
    summary: '상품들을 카테고리에 추가',
    description:
      '여러 상품을 특정 카테고리에 추가로 연결합니다. 기존 카테고리 관계는 유지됩니다 (다대다 관계 지원).',
  })
  @ApiParam({ name: 'id', description: '대상 카테고리 ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        productIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: '추가할 상품 마스터 ID 배열',
          example: [
            '550e8400-e29b-41d4-a716-446655440000',
            '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          ],
        },
      },
      required: ['productIds'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '상품 추가 성공',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({
    status: 404,
    description: '카테고리 또는 상품을 찾을 수 없음',
  })
  async addProductsToCategory(
    @Param('id') categoryId: string,
    @Body() body: { productIds: string[] },
  ): Promise<{ message: string; addedCount: number }> {
    try {
      if (!body.productIds || body.productIds.length === 0) {
        throw new HttpException(
          'productIds are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.productCategoriesService.addProductsToCategory(
        body.productIds,
        categoryId,
      );

      return {
        message: 'Products added successfully',
        addedCount: body.productIds.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to add products: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ===== Phase 2: Category Configuration Endpoints =====

  @Patch(':id/display-settings')
  @ApiOperation({
    summary: '카테고리 표시 설정 업데이트',
    description: '카테고리의 표시 관련 설정을 업데이트합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiBody({ type: UpdateDisplaySettingsDto })
  @ApiResponse({
    status: 200,
    description: '표시 설정 업데이트 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async updateDisplaySettings(
    @Param('id') categoryId: string,
    @Body() dto: UpdateDisplaySettingsDto,
  ): Promise<CategoryResponseDto> {
    try {
      return await this.productCategoriesService.updateDisplaySettings(
        categoryId,
        dto,
      );
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to update display settings: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/seo')
  @ApiOperation({
    summary: '카테고리 SEO 설정 업데이트',
    description: '카테고리의 SEO 관련 설정을 업데이트합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiBody({ type: UpdateSeoConfigDto })
  @ApiResponse({
    status: 200,
    description: 'SEO 설정 업데이트 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async updateSeoConfig(
    @Param('id') categoryId: string,
    @Body() dto: UpdateSeoConfigDto,
  ): Promise<CategoryResponseDto> {
    try {
      return await this.productCategoriesService.updateSeoConfig(
        categoryId,
        dto,
      );
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to update SEO config: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/template')
  @ApiOperation({
    summary: '카테고리 템플릿 설정 업데이트',
    description: '카테고리의 템플릿 관련 설정을 업데이트합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiBody({ type: UpdateTemplateConfigDto })
  @ApiResponse({
    status: 200,
    description: '템플릿 설정 업데이트 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async updateTemplateConfig(
    @Param('id') categoryId: string,
    @Body() dto: UpdateTemplateConfigDto,
  ): Promise<CategoryResponseDto> {
    try {
      return await this.productCategoriesService.updateTemplateConfig(
        categoryId,
        dto,
      );
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to update template config: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/visibility')
  @ApiOperation({
    summary: '카테고리 표시 여부 업데이트',
    description: '카테고리의 표시 여부를 업데이트합니다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        visible: {
          type: 'boolean',
          description: '표시 여부',
          example: true,
        },
      },
      required: ['visible'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '표시 여부 업데이트 성공',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async updateVisibility(
    @Param('id') categoryId: string,
    @Body('visible') visible: boolean,
  ): Promise<CategoryResponseDto> {
    try {
      return await this.productCategoriesService.updateVisibility(
        categoryId,
        visible,
      );
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to update visibility: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ===== TAG GROUP MANAGEMENT =====

  @Put(':categoryId/tag-groups')
  @ApiOperation({
    summary: '카테고리 태그 그룹 연결 설정',
    description: '카테고리에 연결된 태그 그룹을 설정합니다. 기존 연결은 모두 삭제되고 새로운 연결로 교체됩니다.',
  })
  @ApiParam({
    name: 'categoryId',
    description: '카테고리 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: ReplaceTagGroupLinksDto,
    description: '태그 그룹 연결 정보',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: '태그 그룹 연결 설정 성공',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '카테고리를 찾을 수 없음',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '존재하지 않는 태그 그룹 ID',
  })
  async replaceTagGroupLinks(
    @Param('categoryId') categoryId: string,
    @Body() dto: ReplaceTagGroupLinksDto,
  ): Promise<void> {
    try {
      await this.productCategoriesService.replaceTagGroupLinks(
        categoryId,
        dto.links,
      );
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Tag groups not found')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to replace tag group links: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':categoryId/tag-groups')
  @ApiOperation({
    summary: '카테고리 태그 그룹 조회',
    description: '카테고리에 연결된 태그 그룹 및 태그 값을 조회합니다.',
  })
  @ApiParam({
    name: 'categoryId',
    description: '카테고리 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 그룹 조회 성공',
    type: CategoryTagGroupsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '카테고리를 찾을 수 없음',
  })
  async getCategoryTagGroups(
    @Param('categoryId') categoryId: string,
  ): Promise<CategoryTagGroupsResponseDto> {
    try {
      return await this.productCategoriesService.getCategoryTagGroups(categoryId);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to get category tag groups: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
