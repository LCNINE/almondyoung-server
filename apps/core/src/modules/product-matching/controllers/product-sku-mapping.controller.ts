import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ProductSkuMappingService } from '../services/product-sku-mapping.service';
import { UpsertMatchingDto } from '../dto/upsert-matching.dto';

@ApiTags('Product Matchings')
@Controller('matchings')
export class ProductSkuMappingController {
  constructor(private readonly service: ProductSkuMappingService) {}

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
