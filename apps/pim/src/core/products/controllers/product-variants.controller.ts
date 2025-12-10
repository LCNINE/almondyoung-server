import {
  Controller,
  Get,
  Put,
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
import { ProductVariantsService } from '../services/product-variants.service';
import {
  UpdateProductVariantDto,
  UpdateVariantBulkDto,
  UpdateVariantStatusDto,
  VariantWithPriceDto,
  VariantListResponseDto,
  VariantUpdateResponseDto,
  VariantPriceResponseDto,
} from '../dto';
import { PaginatedResponseDto } from '../../../common/dto';
import { ApiOkResponsePaginated } from '../../../common/decorators';

@ApiTags('Product Variants')
@Controller('variants')
export class ProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) { }

  @Get('masters/:masterId')
  @ApiOperation({
    summary: '마스터별 제품 변형 조회',
    description: '특정 제품 마스터의 모든 변형(색상, 사이즈 등)을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: '변형 상태 필터',
  })
  @ApiQuery({
    name: 'includePrice',
    required: false,
    type: String,
    description: '가격 정보 포함 여부 (true/false, 기본값: true)',
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
  @ApiOkResponsePaginated(VariantWithPriceDto, {
    description: '제품 변형 목록 조회 성공',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getVariantsByMaster(
    @Param('masterId') masterId: string,
    @Query()
    query: {
      status?: string;
      includePrice?: string;
      page?: string;
      limit?: string;
    },
  ): Promise<PaginatedResponseDto<VariantWithPriceDto>> {
    const filters = {
      status: query.status,
      includePrice: query.includePrice !== 'false',
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };

    return await this.productVariantsService.getVariantsByMaster(
      masterId,
      undefined, // version (optional)
      filters,
    );
  }


  @Get('masters/:masterId/versions/:versionId')
  @ApiOperation({
    summary: '버전별 제품 변형 조회',
    description: '특정 제품 마스터의 특정 버전의 모든 변형(색상, 사이즈 등)을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiParam({ name: 'versionId', description: '버전 ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: '변형 상태 필터',
  })
  @ApiQuery({
    name: 'includePrice',
    required: false,
    type: String,
    description: '가격 정보 포함 여부 (true/false, 기본값: true)',
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
  @ApiOkResponsePaginated(VariantWithPriceDto, {
    description: '제품 변형 목록 조회 성공',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getVariantsByMasterAndVersion(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
    @Query()
    query: {
      status?: string;
      includePrice?: string;
      page?: string;
      limit?: string;
    },
  ): Promise<PaginatedResponseDto<VariantWithPriceDto>> {
    const filters = {
      status: query.status,
      includePrice: query.includePrice !== 'false',
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };

    return await this.productVariantsService.getVariantsByMaster(
      masterId,
      versionId, // version (optional)
      filters,
    );
  }


  @Get(':id')
  @ApiOperation({
    summary: '제품 변형 상세 조회',
    description: '특정 제품 변형의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
  @ApiParam({ name: 'versionId', description: '버전 ID (둘 중 하나 제공)' })
  @ApiParam({ name: 'masterId', description: '마스터 ID (둘 중 하나 제공)' })
  @ApiResponse({
    status: 200,
    description: '제품 변형 상세 조회 성공',
    type: VariantWithPriceDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '제품 변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getVariantDetail(
    @Param('id') id: string,
    @Query()
    query: {
      versionId?: string;
      masterId?: string;
    },
  ): Promise<VariantWithPriceDto> {
    if (!query.versionId && !query.masterId) {
      throw new HttpException('Version ID or master ID is required', HttpStatus.BAD_REQUEST);
    }

    const variant = query.versionId
      ? await this.productVariantsService.getVariantDetail({ variantId: id, versionId: query.versionId })
      : await this.productVariantsService.getVariantDetail({ variantId: id, masterId: query.masterId! });

    if (!variant) {
      throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
    }

    return variant;
  }

  @Put(':id')
  @ApiOperation({
    summary: '제품 변형 수정',
    description: '기존 제품 변형 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
  @ApiBody({
    type: UpdateProductVariantDto,
    description: '수정할 제품 변형 정보',
  })
  @ApiResponse({
    status: 200,
    description: '제품 변형 수정 성공',
    type: VariantUpdateResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '제품 변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateVariant(
    @Param('id') id: string,
    @Body() updateDto: UpdateProductVariantDto,
  ): Promise<VariantUpdateResponseDto> {
    const updatedVariant = await this.productVariantsService.updateVariant(
      id,
      updateDto,
    );
    return {
      success: true,
      data: updatedVariant as any as VariantWithPriceDto,
    };
  }

  @Put('bulk')
  @ApiOperation({
    summary: '제품 변형 일괄 수정',
    description: '여러 제품 변형을 동시에 수정합니다.',
  })
  @ApiBody({
    type: UpdateVariantBulkDto,
    description: '일괄 수정할 제품 변형 정보',
  })
  @ApiResponse({ status: 200, description: '제품 변형 일괄 수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '일부 제품 변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async bulkUpdateVariants(
    @Body() bulkUpdateDto: UpdateVariantBulkDto,
  ): Promise<void> {
    await this.productVariantsService.bulkUpdateVariants(
      bulkUpdateDto,
    );
  }

  @Get(':id/price')
  @ApiOperation({
    summary: '제품 변형 가격 조회 (Deprecated)',
    description: 'DEPRECATED: Use POST /products/:masterId/pricing/calculate instead. This endpoint has been moved to PricingController.',
    deprecated: true,
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
  @ApiResponse({ status: 410, description: 'Endpoint moved. Use /products/:masterId/pricing/calculate' })
  async getVariantPrice(
    @Param('id') id: string,
  ): Promise<never> {
    throw new HttpException(
      {
        statusCode: HttpStatus.GONE,
        message: 'This endpoint has been moved to PricingController',
        redirect: 'Use POST /products/:masterId/pricing/calculate with { variantId, quantity?, customerType? } in request body',
        alternativeEndpoint: 'GET /products/:masterId/pricing/price-set?variantId=:id for complete price information',
      },
      HttpStatus.GONE,
    );
  }

  @Put(':id/status')
  @ApiOperation({
    summary: '제품 변형 상태 수정',
    description: '제품 변형의 상태를 수정합니다 (활성/비활성 등).',
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
  @ApiBody({ type: UpdateVariantStatusDto, description: '상태 수정 데이터' })
  @ApiResponse({ status: 200, description: '제품 변형 상태 수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터 (status 필수)' })
  @ApiResponse({ status: 404, description: '제품 변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateVariantStatus(
    @Param('id') id: string,
    @Body() statusDto: UpdateVariantStatusDto,
  ): Promise<void> {
    if (!statusDto.status) {
      throw new HttpException('Status is required', HttpStatus.BAD_REQUEST);
    }

    await this.productVariantsService.updateVariantStatus(
      id,
      statusDto.status,
    );
  }
}
