import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  HttpCode,
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
import { MasterProductWithPrimaryVersionDto, ProductDto, ProductListItemDto, ProductListResponseDto } from '../dto/products/product-response.dto';
import { ProductMapper } from '../mappers/product.mapper';
import { DbService, InjectDb } from '@app/db';
import { PimSchema } from 'apps/pim/src/schema';

@ApiTags('Product Masters')
@Controller('masters')
export class ProductMastersController {
  constructor(
    @InjectDb() private readonly dbService: DbService<PimSchema>,
    private readonly productMastersService: ProductMastersService,
    private readonly productVersionsService: ProductVersionsService,
  ) { }

  @Post()
  @ApiOperation({
    summary: '제품 마스터 생성',
    description: `
      새로운 판매 상품을 생성합니다 (Master + 첫 번째 Draft 버전).
      모든 필드는 선택사항이며, 생성 후 수정 가능합니다.
      
      워크플로우:
      1. POST /masters {} - Master + Draft v1 생성 (name: "새 상품", 기본 variant 1개)
      2. PUT /masters/:masterId/versions/:versionId { name, description, ... } - Draft 수정
      3. PUT /masters/:masterId/versions/:versionId { optionDiff: { add: [...] } } - 옵션 추가
      4. PUT /products/:masterId/pricing { ... } - 가격 정책 설정
      5. PATCH /masters/:masterId/versions/:versionId/publish - Draft → Active
      
      **출력:** Master ID, Version ID, Version 번호 등을 포함한 응답
    `,
  })
  @ApiResponse({
    status: 201,
    description: '제품 마스터 생성 성공',
    type: ProductDto,
  })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async createMaster(): Promise<ProductDto> {
    try {
      const master = await this.productMastersService.createMaster();
      return ProductMapper.toDto(master);
    } catch (error) {
      console.error('Create master error:', error);
      throw new HttpException(
        `Failed to create master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: '제품 마스터 목록 조회',
    description: `
      제품 마스터 목록을 필터링 및 페이지네이션과 함께 조회합니다.
      
      **기본 동작:** Active 버전만 반환합니다.
      **옵션:** includeAllVersions=true 시 모든 버전 상태를 포함합니다.
      
      각 항목은 Master ID와 active 버전의 정보를 포함합니다.
    `,
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
    name: 'status',
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
      categoryId?: string;
      brand?: string;
      search?: string;
      status?: 'draft' | 'inactive' | 'active';
      includeAllVersions?: boolean;
    },
  ): Promise<MasterListResponseDto> {
    try {
      const filters = {
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        categoryId: query.categoryId,
        brand: query.brand,
        search: query.search,
        status: query.includeAllVersions ? undefined : (query.status || 'active'),
      };

      return await this.productMastersService.getMasters(filters);
    } catch (error) {
      throw new HttpException(
        'Failed to get masters',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('deleted')
  @ApiOperation({
    summary: '삭제된 제품 마스터 목록 조회',
    description: '소프트 삭제된 제품 마스터 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '삭제된 제품 마스터 목록 조회 성공', type: [MasterProductWithPrimaryVersionDto] })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getDeleted(): Promise<MasterProductWithPrimaryVersionDto[]> {
    try {
      const deleted = await this.productMastersService.findDeleted();
      return deleted;
    } catch (error) {
      console.error('Failed to get deleted masters:', error);
      throw new HttpException(
        'Failed to get deleted masters',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: '제품 마스터 상세 조회 (Active 버전)',
    description: `
      Master ID를 받아 해당 Master의 active 버전 상세 정보를 조회합니다.
      이미지, 옵션 그룹, Variant, 채널 제품 정보를 포함합니다.
      
      **입력:** Master ID (product_masters.id)
      **출력:** Active 버전의 상세 정보
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Master ID - active 버전을 자동으로 조회합니다',
  })
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
      const masterDetail = await this.productMastersService.getMasterDetail(id);

      if (!masterDetail) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      // 이미지 정보를 포함한 응답 반환
      return masterDetail
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

  @Delete(':masterId')
  @ApiOperation({
    summary: '제품 마스터 소프트 삭제',
    description: `
      Master ID를 받아 해당 Master를 소프트 삭제합니다.
      
      Master가 삭제되면 해당 Master의 모든 버전은 조회되지 않습니다.
      Active 버전이 있었다면 WMS에 ProductMasterDeleted 이벤트를 발행합니다.
      
      삭제된 Master는 복원이 가능합니다.
    `,
  })
  @ApiParam({
    name: 'masterId',
    description: 'Master ID (product_masters.id)',
  })
  @ApiResponse({ status: 200, description: 'Master 소프트 삭제 성공' })
  @ApiResponse({ status: 400, description: '이미 삭제된 Master' })
  @ApiResponse({ status: 404, description: 'Master를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async deleteMaster(
    @Param('masterId') masterId: string,
    @Body('userId') userId?: string,
  ) {
    try {
      const userIdToUse = userId || '00000000-0000-0000-0000-000000000000';
      const deleted = await this.productMastersService.deleteMaster(
        masterId,
        userIdToUse,
      );

      return {
        success: true,
        message: 'Master deleted successfully',
        masterId: deleted.id,
        deletedAt: deleted.deletedAt?.toISOString(),
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('already deleted')) {
        throw new HttpException(
          'Master is already deleted',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        `Failed to delete master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':masterId/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: '제품 마스터 복원',
    description: '소프트 삭제된 Master를 복원합니다.',
  })
  @ApiParam({
    name: 'masterId',
    description: 'Master ID (product_masters.id)',
  })
  @ApiResponse({ status: 200, description: 'Master 복원 성공' })
  @ApiResponse({ status: 400, description: 'Master가 삭제되지 않았음' })
  @ApiResponse({ status: 404, description: 'Master를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async restore(
    @Param('masterId') masterId: string,
    @Body('userId') userId?: string,
  ) {
    try {
      const userIdToUse = userId || '00000000-0000-0000-0000-000000000000';
      const restored = await this.productMastersService.restoreMaster(
        masterId,
      );

      return {
        success: true,
        message: 'Master restored successfully',
        masterId: restored.id,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('not deleted')) {
        throw new HttpException(
          'Master is not deleted',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        `Failed to restore master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':masterId/unpublish')
  @ApiOperation({
    summary: '제품 마스터 비공개 처리',
    description: `
      현재 Active 상태인 버전을 Inactive로 전환하여 상품을 비공개 처리합니다.
      
      Master당 Active 버전은 최대 1개이므로, 해당 버전을 찾아서 Inactive로 전환합니다.
      비공개된 상품을 다시 공개하려면 새 Draft 버전을 만들어 publish 해야 합니다.
    `,
  })
  @ApiParam({
    name: 'masterId',
    description: 'Master ID (product_masters.id)',
  })
  @ApiResponse({ status: 200, description: '상품 비공개 처리 성공' })
  @ApiResponse({ status: 404, description: 'Master를 찾을 수 없거나 Active 버전이 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async unpublish(@Param('masterId') masterId: string) {
    try {
      await this.productVersionsService.unpublishMaster(masterId);
      return {
        success: true,
        message: 'Master unpublished successfully',
        masterId,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(
          'Master not found or no active version exists',
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        `Failed to unpublish master: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id/permanent')
  @ApiOperation({
    summary: '제품 버전 영구 삭제',
    description: `
      **현재 구현:** Version ID를 받아 특정 버전을 영구 삭제합니다.
      
      **주의:** 이 작업은 되돌릴 수 없습니다.
      현재 구현은 Master ID가 아닌 Version ID를 기대합니다.
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Version ID (현재 구현에서는 Master ID가 아님)',
  })
  @ApiResponse({ status: 200, description: '제품 마스터 영구 삭제 성공' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async hardDelete(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ): Promise<{ deleted: boolean }> {
    try {
      // TODO: Get userId from JWT auth
      const userIdToUse = userId || '00000000-0000-0000-0000-000000000000';
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
