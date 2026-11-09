import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { BundleOfferResponseDto, ReplaceBundleOffersDto } from './dto';
import { BundleOfferService } from './bundle-offer.service';

@ApiTags('Bundle Offers')
@Controller('masters/:masterId/bundle-offers')
export class BundleOfferController {
  constructor(private readonly service: BundleOfferService) {}

  @RequirePermission('catalog.product.read')
  @Get()
  @ApiOperation({ summary: '상품의 함께 구매 구성품 조회' })
  @ApiParam({ name: 'masterId' })
  @ApiResponse({ status: 200, type: [BundleOfferResponseDto] })
  get(@Param('masterId', ParseUUIDPipe) masterId: string): Promise<BundleOfferResponseDto[]> {
    return this.service.getForMaster(masterId);
  }

  @RequirePermission('catalog.price.write')
  @Put()
  @ApiOperation({
    summary: '상품의 함께 구매 구성품 전체 저장',
    description: '보낸 목록으로 통째로 바꾼다(빈 목록은 모두 해제). 버전 발행 없이 저장 즉시 쇼핑몰에 반영된다.',
  })
  @ApiParam({ name: 'masterId' })
  @ApiBody({ type: ReplaceBundleOffersDto })
  @ApiResponse({ status: 200, type: [BundleOfferResponseDto] })
  @ApiResponse({ status: 400, description: '구성품 검증 실패(errors 에 위반 목록)' })
  replace(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Body() body: ReplaceBundleOffersDto,
  ): Promise<BundleOfferResponseDto[]> {
    return this.service.replaceForMaster(
      masterId,
      body.offers.map((o) => ({
        addonMasterId: o.addonMasterId,
        allowedVariantIds: o.allowedVariantIds ?? null,
        regularRateBp: o.regularRateBp,
        membershipRateBp: o.membershipRateBp,
        enabled: o.enabled,
        startsOn: o.startsOn ?? null,
        endsOn: o.endsOn ?? null,
        label: o.label ?? null,
      })),
    );
  }
}
