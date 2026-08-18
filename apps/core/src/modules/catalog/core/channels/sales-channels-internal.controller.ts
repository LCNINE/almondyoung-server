import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { SalesChannelsService } from './sales-channels.service';
import { ActiveChannelSitesDto } from './dto';

/**
 * 서비스 간 호출 전용 판매채널 라우트. 사람 JWT 가 없는 호출자(현재는 channel-adapter 의 폴링
 * 게이트)가 공유 키로 부른다.
 *
 * 어드민용 `SalesChannelsController` 와 파일을 나눈 것은 의도다 — 한 컨트롤러에 두 인증 체제를
 * 섞으면 핸들러를 더하는 사람이 어느 규칙인지 헷갈린다. 여기는 클래스 단위로 `@InternalOnly()`
 * 가 걸려 있어 무엇을 더하든 보호된다.
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/channels')
export class SalesChannelsInternalController {
  constructor(private readonly salesChannelsService: SalesChannelsService) {}

  /**
   * 활성 판매채널의 `site` 목록. 채널 행 전체가 아니라 사이트 문자열만 돌려준다 —
   * 판매채널 행에는 발송인 이름·전화·주소(`config.sender`)와 `apiEndpoint` 가 들어 있고,
   * 내부 키로 막혀 있어도 게이트 판정에 필요 없는 것을 실어보낼 이유가 없다.
   */
  @Get('active-sites')
  async getActiveSites(): Promise<ActiveChannelSitesDto> {
    const sites = await this.salesChannelsService.getActiveChannelSites();
    return { sites };
  }
}
