import { ApiProperty } from '@nestjs/swagger';
import { SALES_CHANNELS } from '@packages/event-contracts/streams';

/**
 * 활성 판매채널의 `site` 목록. 서비스 간 게이트 판정에 필요한 최소한만 담는다 —
 * 판매채널 행 전체(`SalesChannelDto`)에는 발송인 정보와 `apiEndpoint` 가 딸려 있다.
 */
export class ActiveChannelSitesDto {
  @ApiProperty({
    description: '활성 상태인 판매채널의 site 목록 (중복 없음)',
    isArray: true,
    enum: SALES_CHANNELS,
    example: ['medusa'],
  })
  sites: string[];
}
