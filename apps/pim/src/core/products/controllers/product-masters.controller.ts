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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ProductMastersService } from '../services/product-masters.service';
import { ProductVersionsService } from '../services/product-versions.service';
import { ZodValidationPipe } from '@app/shared';
import {
  CreateMasterDto,
  CreateMasterSchema,
  CreateMasterDtoSwagger,
  UpdateProductMasterDto,
  ProductMasterDto,
  MasterDetailDto,
  MasterListItemDto,
  MasterListResponseDto,
  MasterUpdateResponseDto,
} from '../dto';

@ApiTags('Product Masters')
@Controller('masters')
export class ProductMastersController {
  constructor(
    private readonly productMastersService: ProductMastersService,
    private readonly productVersionsService: ProductVersionsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '제품 마스터 생성 (최적화됨)',
    description: '새로운 제품 마스터를 생성합니다. 상품 마스터는 즉시 생성되고, 옵션 처리는 백그라운드에서 비동기로 처리됩니다.',
  })
  @ApiBody({ type: CreateMasterDtoSwagger, description: '제품 마스터 생성 정보' })
  @ApiResponse({
    status: 201,
    description: '제품 마스터 생성 성공 (옵션 처리는 백그라운드에서 진행)',
    type: ProductMasterDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터 (name, basePrice 필수)',
  })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async createMaster(
    @Body(new ZodValidationPipe(CreateMasterSchema))
    createMasterDto: CreateMasterDto,
  ): Promise<ProductMasterDto> {
    try {
      if (
        !createMasterDto.name ||
        !createMasterDto.basePrice
      ) {
        throw new HttpException('Validation failed', HttpStatus.BAD_REQUEST);
      }

      // 상품 마스터 생성 (옵션은 백그라운드에서 처리)
      const master =
        await this.productMastersService.createMaster(createMasterDto);

      // 즉시 응답 반환 (옵션 처리는 비동기로 진행 중)
      return {
        ...master,
        createdAt: master.createdAt?.toISOString() || null,
        updatedAt: master.updatedAt?.toISOString() || null,
      } as unknown as ProductMasterDto;
    } catch (error) {
      console.error('Create master error:', error);
      if (error.message === 'Validation failed') {
        throw error;
      }
      throw new HttpException(
        `Failed to create master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: '제품 마스터 목록 조회',
    description: '제품 마스터 목록을 필터링 및 페이지네이션과 함께 조회합니다.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: String,
    description: '페이지 번호',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: String,
    description: '페이지 당 아이템 수',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: '제품 상태 필터',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    description: '카테고리 ID 필터',
  })
  @ApiQuery({
    name: 'brand',
    required: false,
    type: String,
    description: '브랜드 필터',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: '검색 키워드',
  })
  @ApiQuery({
    name: 'versionStatus',
    required: false,
    type: String,
    enum: ['draft', 'inactive', 'active'],
    description: '버전 상태 필터 (기본값: active)',
  })
  @ApiQuery({
    name: 'includeAllVersions',
    required: false,
    type: Boolean,
    description: '모든 버전 포함 여부 (기본값: false, active만 조회)',
  })
  @ApiResponse({
    status: 200,
    description: '제품 마스터 목록 조회 성공',
    type: MasterListResponseDto,
  })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getMasters(
    @Query()
    query: {
      page?: string;
      limit?: string;
      status?: string;
      categoryId?: string;
      brand?: string;
      search?: string;
      versionStatus?: 'draft' | 'inactive' | 'active';
      includeAllVersions?: boolean;
    },
  ): Promise<MasterListResponseDto> {
    try {
      const filters = {
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        status: query.status,
        categoryId: query.categoryId,
        brand: query.brand,
        search: query.search,
        versionStatus: query.includeAllVersions ? undefined : (query.versionStatus || 'active'),
      };

      return await this.productMastersService.getMasters(filters);
    } catch (error) {
      throw new HttpException(
        'Failed to get masters',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: '제품 마스터 상세 조회 (이미지 포함)',
    description: '특정 제품 마스터의 상세 정보와 연결된 이미지들을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiResponse({
    status: 200,
    description: '제품 마스터 상세 조회 성공',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        brand: { type: 'string' },
        basePrice: { type: 'number' },
        status: { type: 'string' },
        isWholesaleOnly: { type: 'boolean' },
        isMembershipOnly: { type: 'boolean' },
        images: {
          type: 'object',
          properties: {
            primary: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                url: { type: 'string' },
                originalName: { type: 'string' },
                fileName: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'number' },
              },
              nullable: true,
            },
            additional: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  originalName: { type: 'string' },
                  fileName: { type: 'string' },
                  sortOrder: { type: 'number' },
                },
              },
            },
          },
        },
        optionGroups: { type: 'array' },
        variants: { type: 'array' },
        channelProducts: { type: 'array' },
      },
    },
  })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getMasterDetail(@Param('id') id: string) {
    try {
      // 이미지 정보를 포함한 마스터 조회
      const masterWithImages =
        await this.productMastersService.getMasterWithImages(id);

      if (!masterWithImages) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      // 기존 상세 정보도 가져오기 (옵션 그룹, 변형, 채널 제품 등)
      const masterDetail = await this.productMastersService.getMasterDetail(id);

      if (!masterDetail) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      // 이미지 정보를 포함한 응답 반환
      return {
        ...masterDetail,
        images: masterWithImages.images,
      };
    } catch (error) {
      if (
        error.message === 'Master not found' ||
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to get master detail',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  @ApiOperation({
    summary: '제품 마스터 수정',
    description: '기존 제품 마스터 정보를 수정합니다. draft 상태의 버전만 수정 가능합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID (버전 ID)' })
  @ApiBody({
    type: UpdateProductMasterDto,
    description: '수정할 제품 마스터 정보',
  })
  @ApiResponse({
    status: 200,
    description: '제품 마스터 수정 성공',
    type: MasterUpdateResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 403, description: 'draft 상태의 버전만 수정 가능' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateMaster(
    @Param('id') id: string,
    @Body() updateData: UpdateProductMasterDto,
  ): Promise<MasterUpdateResponseDto> {
    try {
      // TODO: JWT에서 실제 userId 추출 (현재는 'system' 사용)
      const userId = 'system';

      const canModify = await this.productVersionsService.canUserModifyVersion(
        id,
        userId,
      );

      if (!canModify) {
        throw new HttpException(
          'Only draft versions can be modified. Create a new draft version to make changes.',
          HttpStatus.FORBIDDEN,
        );
      }

      const updatedMaster = await this.productMastersService.updateMaster(
        id,
        updateData,
      );
      return {
        success: true,
        data: updatedMaster as unknown as ProductMasterDto,
      };
    } catch (error) {
      if (error.status === HttpStatus.FORBIDDEN) {
        throw error;
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to update master',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({
    summary: '제품 마스터 소프트 삭제',
    description: '제품 마스터를 소프트 삭제합니다. 실제로 데이터는 삭제되지 않으며 복원이 가능합니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '제품 마스터 소프트 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 요구사항 불충족' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async deleteMaster(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ): Promise<ProductMasterDto> {
    try {
      // TODO: Get userId from JWT auth
      const userIdToUse = userId || 'system';
      const deleted = await this.productMastersService.softDelete(id, userIdToUse);

      return {
        ...deleted,
        createdAt: deleted.createdAt?.toISOString() || null,
        updatedAt: deleted.updatedAt?.toISOString() || null,
      } as unknown as ProductMasterDto;
    } catch (error) {
      if (
        error.message.includes('not found') ||
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('already deleted')) {
        throw new HttpException('Product is already deleted', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to delete master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('deleted')
  @ApiOperation({
    summary: '삭제된 제품 마스터 목록 조회',
    description: '소프트 삭제된 제품 마스터 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '삭제된 제품 마스터 목록 조회 성공' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getDeleted(): Promise<ProductMasterDto[]> {
    try {
      const deleted = await this.productMastersService.findDeleted();
      return deleted.map(master => ({
        ...master,
        createdAt: master.createdAt?.toISOString() || null,
        updatedAt: master.updatedAt?.toISOString() || null,
      })) as unknown as ProductMasterDto[];
    } catch (error) {
      throw new HttpException(
        'Failed to get deleted masters',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/restore')
  @ApiOperation({
    summary: '제품 마스터 복원',
    description: '소프트 삭제된 제품 마스터를 복원합니다.',
  })
  @ApiParam({ name: 'id', description: '복원할 제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '제품 마스터 복원 성공' })
  @ApiResponse({ status: 400, description: '제품이 삭제되지 않았음' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async restore(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ): Promise<ProductMasterDto> {
    try {
      // TODO: Get userId from JWT auth
      const userIdToUse = userId || 'system';
      const restored = await this.productMastersService.restore(id, userIdToUse);

      return {
        ...restored,
        createdAt: restored.createdAt?.toISOString() || null,
        updatedAt: restored.updatedAt?.toISOString() || null,
      } as unknown as ProductMasterDto;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('not deleted')) {
        throw new HttpException('Product is not deleted', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to restore master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id/permanent')
  @ApiOperation({
    summary: '제품 마스터 영구 삭제',
    description: '제품 마스터를 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
  })
  @ApiParam({ name: 'id', description: '영구 삭제할 제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '제품 마스터 영구 삭제 성공' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async hardDelete(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ): Promise<{ deleted: boolean }> {
    try {
      // TODO: Get userId from JWT auth
      const userIdToUse = userId || 'system';
      return await this.productMastersService.hardDelete(id, userIdToUse);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Failed to hard delete master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // NOTE: Price preview and pricing strategy endpoints have been removed.
  // Use the new pricing rules API instead:
  //   - GET /products/:masterId/pricing-rules
  //   - PUT /products/:masterId/pricing-rules
  //   - POST /products/:masterId/pricing/calculate
}
