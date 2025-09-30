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
import { ZodValidationPipe } from '@app/shared';
import {
  CreateMasterDto,
  UpdateProductMasterDto,
  ChangePricingStrategyDto,
  ProductMasterDto,
  MasterDetailDto,
  PricePreviewDto,
  MasterListResponseDto,
  MasterUpdateResponseDto,
  CreateMasterSchema,
  UpdateProductMasterSchema,
  ChangePricingStrategySchema,
} from '../schemas/product-masters.schema';

@ApiTags('Product Masters')
@Controller('masters')
export class ProductMastersController {
  constructor(private readonly productMastersService: ProductMastersService) {}

  @Post()
  @ApiOperation({
    summary: '제품 마스터 생성',
    description: '새로운 제품 마스터를 생성합니다.',
  })
  @ApiBody({ type: CreateMasterDto, description: '제품 마스터 생성 정보' })
  @ApiResponse({
    status: 201,
    description: '제품 마스터 생성 성공',
    type: ProductMasterDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터 (name, basePrice, pricingStrategy 필수)',
  })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async createMaster(
    @Body(new ZodValidationPipe(CreateMasterSchema))
    createMasterDto: CreateMasterDto,
  ): Promise<ProductMasterDto> {
    try {
      if (
        !createMasterDto.name ||
        !createMasterDto.basePrice ||
        !createMasterDto.pricingStrategy
      ) {
        throw new HttpException('Validation failed', HttpStatus.BAD_REQUEST);
      }

      const master =
        await this.productMastersService.createMaster(createMasterDto);

      return master as unknown as ProductMasterDto;
    } catch (error) {
      console.error('Create master error:', error);
      console.error('Error stack:', error.stack);
      console.error('Request data:', createMasterDto);
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
    name: 'pricingStrategy',
    required: false,
    type: String,
    description: '가격 전략 필터',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: '검색 키워드',
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
      pricingStrategy?: string;
      search?: string;
    },
  ): Promise<MasterListResponseDto> {
    try {
      const filters = {
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        status: query.status,
        categoryId: query.categoryId,
        brand: query.brand,
        pricingStrategy: query.pricingStrategy,
        search: query.search,
      };

      return (await this.productMastersService.getMasters(
        filters,
      )) as unknown as MasterListResponseDto;
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
        pricingStrategy: { type: 'string' },
        status: { type: 'string' },
        isWholesaleOnly: { type: 'boolean' },
        isMembershipOnly: { type: 'boolean' },
        membershipPrice: { type: 'number' },
        wholesalePrice: { type: 'number' },
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
    description: '기존 제품 마스터 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
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
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateMaster(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductMasterSchema))
    updateData: UpdateProductMasterDto,
  ): Promise<MasterUpdateResponseDto> {
    try {
      const updatedMaster = await this.productMastersService.updateMaster(
        id,
        updateData,
      );
      return {
        success: true,
        data: updatedMaster as unknown as ProductMasterDto,
      };
    } catch (error) {
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
    summary: '제품 마스터 삭제',
    description: '제품 마스터를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '삭제할 제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '제품 마스터 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 요구사항 불충족' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async deleteMaster(@Param('id') id: string): Promise<void> {
    try {
      const deleted = await this.productMastersService.deleteMaster(id);

      if (!deleted) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
    } catch (error) {
      if (
        error.message === 'Master not found' ||
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to delete master',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/price-preview')
  @ApiOperation({
    summary: '가격 미리보기',
    description: '제품 마스터의 가격 전략 적용 미리보기를 제공합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiResponse({
    status: 200,
    description: '가격 미리보기 성공',
    type: PricePreviewDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getPricePreview(@Param('id') id: string): Promise<PricePreviewDto> {
    try {
      return (await this.productMastersService.getPricePreview(
        id,
      )) as unknown as PricePreviewDto;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to get price preview',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id/pricing')
  @ApiOperation({
    summary: '가격 전략 변경',
    description: '제품 마스터의 가격 전략을 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiBody({
    type: ChangePricingStrategyDto,
    description: '가격 전략 변경 데이터',
  })
  @ApiResponse({ status: 200, description: '가격 전략 변경 성공' })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터 (pricingStrategy 필수)',
  })
  @ApiResponse({ status: 404, description: '제품 마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async changePricingStrategy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangePricingStrategySchema))
    pricingDto: ChangePricingStrategyDto,
  ): Promise<void> {
    try {
      if (!pricingDto.pricingStrategy) {
        throw new HttpException(
          'Pricing strategy is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const master = await this.productMastersService.getMasterById(id);
      if (!master) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }

      await this.productMastersService.changePricingStrategy(
        id,
        pricingDto.pricingStrategy as any,
        pricingDto.migrationData,
      );
    } catch (error) {
      if (
        error.message === 'Master not found' ||
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new HttpException('Master not found', HttpStatus.NOT_FOUND);
      }
      if (
        error.message.includes('required') ||
        error.message.includes('Invalid')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to change pricing strategy',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
