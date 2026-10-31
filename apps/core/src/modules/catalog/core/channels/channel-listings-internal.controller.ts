import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { ChannelListingService } from './channel-listing.service';
import { ResolveChannelListingResponseDto } from './dto';

/**
 * 서비스 간 호출 전용 리스팅 해석. channel-adapter 가 주문 라인을 판매상품 variant 로 식별할 때 공유 키로 부른다(#674).
 *
 * 전에는 어드민 `ChannelListingController` 의 `@Public` 라우트(`/channel-listings/lookup`·`/resolve`)였다. 무인증 라우트는
 * 호출자가 보낸 테넌트 헤더로만 DB 를 고르므로, 내부 키를 쥔 서비스 호출은 내부 키 입구로 옮겼다. 사유 없는 `/lookup` 은
 * `/resolve` 가 없던 옛 Core 를 위한 폴백이라 함께 지웠다.
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/channel-listings')
export class ChannelListingsInternalController {
  constructor(private readonly channelListingService: ChannelListingService) {}

  /** 미스도 200 이며 `{ found: false, cause }` 본문을 갖는다. */
  @Get('resolve')
  async resolve(
    @Query('salesChannelId') salesChannelId?: string,
    @Query('channelCode') channelCode?: string,
    @Query('channelItemId') channelItemId?: string,
  ): Promise<ResolveChannelListingResponseDto> {
    if (!channelItemId) {
      throw new BadRequestException('channelItemId is required');
    }
    if (!salesChannelId && !channelCode) {
      throw new BadRequestException('Either salesChannelId or channelCode is required');
    }

    const result = salesChannelId
      ? await this.channelListingService.resolveVariant(salesChannelId, channelItemId)
      : await this.channelListingService.resolveVariantByChannelCode(channelCode!, channelItemId);

    return result.found ? { found: true, listing: result.listing } : { found: false, cause: result.cause };
  }
}
