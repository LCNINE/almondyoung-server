import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { QuantityDiscountResponseDto, UpsertQuantityDiscountDto } from './dto';
import { QuantityDiscountService } from './quantity-discount.service';

@ApiTags('Version Pricing')
@Controller('masters/:masterId/versions/:versionId/quantity-discount')
export class QuantityDiscountController {
  constructor(private readonly service: QuantityDiscountService) {}

  @RequirePermission('catalog.product.read')
  @Get()
  @ApiOperation({ summary: '버전의 수량 할인 구간표 조회' })
  @ApiParam({ name: 'masterId' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({ status: 200, type: QuantityDiscountResponseDto })
  get(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ): Promise<QuantityDiscountResponseDto | null> {
    return this.service.getForVersion(masterId, versionId);
  }

  @RequirePermission('catalog.price.write')
  @Put()
  @ApiOperation({
    summary: 'Draft 버전 수량 할인 구간표 저장',
    description: '빈 구간 배열이면 구간표를 지운다. 버전을 발행해야 쇼핑몰에 반영된다.',
  })
  @ApiParam({ name: 'masterId' })
  @ApiParam({ name: 'versionId', description: 'draft 버전' })
  @ApiBody({ type: UpsertQuantityDiscountDto })
  @ApiResponse({ status: 200, type: QuantityDiscountResponseDto })
  @ApiResponse({ status: 400, description: 'draft 아님, 또는 구간표 검증 실패(errors 에 위반 목록)' })
  upsert(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
    @Body() body: UpsertQuantityDiscountDto,
  ): Promise<QuantityDiscountResponseDto | null> {
    return this.service.upsertForDraft(masterId, versionId, {
      enabled: body.enabled,
      startsOn: body.startsOn ?? null,
      endsOn: body.endsOn ?? null,
      tiers: body.tiers,
      variantOverrides: body.variantOverrides ?? [],
    });
  }
}
