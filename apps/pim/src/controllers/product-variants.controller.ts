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
} from '../schemas/product-variants.schema';

@ApiTags('Product Variants')
@Controller('variants')
export class ProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

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
  @ApiResponse({
    status: 200,
    description: '제품 변형 목록 조회 성공',
    type: VariantListResponseDto,
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
  ): Promise<VariantListResponseDto> {
    try {
      const filters = {
        status: query.status,
        includePrice: query.includePrice !== 'false',
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      };

      return (await this.productVariantsService.getVariantsByMaster(
        masterId,
        filters,
      )) as unknown as VariantListResponseDto;
    } catch (error) {
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to get variants by master',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: '제품 변형 상세 조회',
    description: '특정 제품 변형의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
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
  ): Promise<VariantWithPriceDto> {
    try {
      const variant = await this.productVariantsService.getVariantDetail(id);

      if (!variant) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }

      return variant as unknown as VariantWithPriceDto;
    } catch (error) {
      if (
        error.message === 'Variant not found' ||
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to get variant detail',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      const updatedVariant = await this.productVariantsService.updateVariant(
        id,
        updateDto,
      );
      return {
        success: true,
        data: updatedVariant as unknown as VariantWithPriceDto,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to update variant',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      await this.productVariantsService.bulkUpdateVariants(
        bulkUpdateDto as any,
      );
    } catch (error) {
      if (
        error.message.includes('required') ||
        error.message.includes('Invalid')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to bulk update variants',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/price')
  @ApiOperation({
    summary: '제품 변형 가격 조회',
    description: '특정 제품 변형의 계산된 가격을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 변형 ID' })
  @ApiResponse({
    status: 200,
    description: '제품 변형 가격 조회 성공',
    type: VariantPriceResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '제품 변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getVariantPrice(
    @Param('id') id: string,
  ): Promise<VariantPriceResponseDto> {
    try {
      const price = await this.productVariantsService.calculateVariantPrice(id);
      return {
        variantId: id,
        price,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to calculate variant price',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      if (!statusDto.status) {
        throw new HttpException('Status is required', HttpStatus.BAD_REQUEST);
      }

      await this.productVariantsService.updateVariantStatus(
        id,
        statusDto.status,
      );
    } catch (error) {
      if (
        error.message.includes('required') ||
        error.message.includes('Invalid')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Variant not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to update variant status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
