import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBody, ApiResponse } from '@nestjs/swagger';
import { ProductSkuMappingService } from '../services/product-sku-mapping.service';
import { UpsertMatchingDto } from '../dto/upsert-matching.dto';
import {
  BatchVariantMatchingsRequestDto,
  UpdateVariantStockPolicyDto,
  VariantMatchingBatchItemDto,
  VariantMatchingBatchResponseDto,
} from '../dto/variant-matching-batch.dto';

@ApiTags('Product Matchings')
@Controller('matchings')
export class ProductSkuMappingController {
  constructor(private readonly service: ProductSkuMappingService) {}

  @Post('variants/batch')
  @ApiOperation({
    summary: 'Variant 운영 매칭 정보 일괄 조회',
    description: '요청한 variant ID 순서와 중복을 보존해 운영 매칭, 재고 정책, 판매 가능 projection을 반환합니다.',
  })
  @ApiBody({ type: BatchVariantMatchingsRequestDto })
  @ApiResponse({ status: 200, type: VariantMatchingBatchResponseDto })
  async getVariantMatchingBatch(@Body() dto: BatchVariantMatchingsRequestDto) {
    try {
      return await this.service.getVariantMatchingBatch(dto.variantIds);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }

  @Put('variants/:variantId/stock-policy')
  @ApiOperation({
    summary: 'Variant 운영 재고 정책 저장',
    description: '매칭 여부와 무관하게 variant-level 판매 정책을 저장하고 판매 가능 projection을 재계산합니다.',
  })
  @ApiBody({ type: UpdateVariantStockPolicyDto })
  @ApiResponse({ status: 200, type: VariantMatchingBatchItemDto })
  async updateVariantStockPolicy(@Param('variantId') variantId: string, @Body() dto: UpdateVariantStockPolicyDto) {
    try {
      return await this.service.updateVariantStockPolicy(variantId, dto);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get(':variantId')
  async get(@Param('variantId') variantId: string) {
    try {
      return await this.service.getByVariant(variantId);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Put(':variantId')
  async upsert(@Param('variantId') variantId: string, @Body() dto: UpsertMatchingDto) {
    try {
      return await this.service.upsert(variantId, dto);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('masters/batch-stats')
  @ApiOperation({
    summary: '마스터별 매칭 통계 일괄 조회',
    description: '여러 마스터의 variant 매칭 상태를 한 번에 조회합니다.',
  })
  @ApiQuery({ name: 'masterIds', description: 'Comma-separated master IDs', required: true })
  async getBatchMasterStats(@Query('masterIds') masterIds: string) {
    const ids = masterIds.split(',').filter((id) => id.trim());
    try {
      return await this.service.getMastersBatchStats(ids);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }
}
