import { Controller, Get, Put, Body, Param, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { MatchingsService } from '../services/matchings.service';

const UpsertMatchingSchema = z.object({
  masterId: z.string().uuid().nullable().optional(), // @deprecated - 더 이상 사용되지 않음
  links: z.array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().default(1) })).default([]),
  policy: z.object({ inventoryManagement: z.boolean().optional(), preStockSellable: z.boolean().optional(), alwaysSellableZeroStock: z.boolean().optional() }).optional(),
});

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
}


