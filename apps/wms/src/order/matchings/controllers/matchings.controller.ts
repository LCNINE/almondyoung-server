import { Controller, Get, Put, Body, Param, Query, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { MatchingsService } from '../services/matchings.service';

const UpsertMatchingSchema = z.object({
  masterId: z.string().uuid().nullable().optional(),
  links: z.array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().default(1) })).default([]),
  policy: z.object({ inventoryManagement: z.boolean().optional(), preStockSellable: z.boolean().optional(), alwaysSellableZeroStock: z.boolean().optional() }).optional(),
});

@ApiTags('Product Matchings')
@Controller('matchings')
export class MatchingsController {
  constructor(private readonly service: MatchingsService) {}

  @Get(':variantId')
  get(@Param('variantId') variantId: string) {
    return this.service.getByVariant(variantId);
  }

  @Put(':variantId')
  @UsePipes(new ZodValidationPipe(UpsertMatchingSchema))
  upsert(@Param('variantId') variantId: string, @Body() dto: any) {
    return this.service.upsert({ variantId, ...dto });
  }

  @Get('masters/batch-stats')
  @ApiOperation({ 
    summary: '마스터별 매칭 통계 일괄 조회',
    description: '여러 마스터의 variant 매칭 상태를 한 번에 조회합니다.'
  })
  @ApiQuery({ 
    name: 'masterIds', 
    description: 'Comma-separated master IDs',
    example: 'uuid1,uuid2,uuid3',
    required: true
  })
  async getBatchMasterStats(@Query('masterIds') masterIds: string) {
    const ids = masterIds.split(',').filter(id => id.trim());
    return this.service.getMastersBatchStats(ids);
  }
}


