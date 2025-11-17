import { Controller, Get, Put, Body, Param, UsePipes } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { MatchingsService } from '../services/matchings.service';

const UpsertMatchingSchema = z.object({
  masterId: z.string().uuid().nullable().optional(),
  links: z.array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().default(1) })).default([]),
  policy: z.object({ inventoryManagement: z.boolean().optional(), preStockSellable: z.boolean().optional(), alwaysSellableZeroStock: z.boolean().optional() }).optional(),
});

@ApiTags('Matchings')
@Controller('wms/matchings')
export class MatchingsController {
  constructor(private readonly service: MatchingsService) {}

  @Get(':variantId')
  @ApiOperation({
    summary: '변형별 상품 매칭 조회',
    description: '특정 제품 변형(Variant)에 대한 SKU 매칭 정보를 조회합니다.',
  })
  @ApiParam({ name: 'variantId', description: '제품 변형 ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: '상품 매칭 정보 조회 성공',
    schema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        masterId: { type: 'string', nullable: true },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              skuId: { type: 'string' },
              quantity: { type: 'number' },
            },
          },
        },
        policy: {
          type: 'object',
          properties: {
            inventoryManagement: { type: 'boolean' },
            preStockSellable: { type: 'boolean' },
            alwaysSellableZeroStock: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: '변형을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  get(@Param('variantId') variantId: string) {
    return this.service.getByVariant(variantId);
  }

  @Put(':variantId')
  @ApiOperation({
    summary: '상품 매칭 생성/수정',
    description: '제품 변형과 SKU 간의 매칭 관계를 생성하거나 수정합니다.',
  })
  @ApiParam({ name: 'variantId', description: '제품 변형 ID (UUID)' })
  @ApiBody({
    description: '상품 매칭 데이터',
    schema: {
      type: 'object',
      properties: {
        masterId: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          description: '제품 마스터 ID (선택사항)',
        },
        links: {
          type: 'array',
          description: 'SKU 매칭 링크 목록',
          items: {
            type: 'object',
            properties: {
              skuId: { type: 'string', format: 'uuid', description: 'SKU ID' },
              quantity: {
                type: 'number',
                description: '수량 (기본값: 1)',
                minimum: 1,
              },
            },
            required: ['skuId'],
          },
          default: [],
        },
        policy: {
          type: 'object',
          description: '재고 관리 정책',
          properties: {
            inventoryManagement: {
              type: 'boolean',
              description: '재고 관리 활성화 여부',
            },
            preStockSellable: {
              type: 'boolean',
              description: '입고 전 판매 가능 여부',
            },
            alwaysSellableZeroStock: {
              type: 'boolean',
              description: '재고 0일 때도 항상 판매 가능 여부',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '상품 매칭 생성/수정 성공',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '변형 또는 SKU를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(UpsertMatchingSchema))
  upsert(@Param('variantId') variantId: string, @Body() dto: any) {
    return this.service.upsert({ variantId, ...dto });
  }
}


