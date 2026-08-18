import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface ActiveChannelSitesResponse {
  sites: string[];
}

/**
 * Core 판매채널 API 클라이언트 (서비스 간 내부 호출).
 *
 * 책임: 활성 판매채널의 `site` 목록 조회. 수집 게이트(#654)가 폴링마다 한 번 부른다.
 *
 * 실패를 삼키지 않는다 — "활성 여부를 모른다" 와 "활성인 채널이 없다" 는 전혀 다른 상태이고,
 * 후자로 뭉개면 게이트가 잘못된 근거로 판정한다. 판정은 호출부(orchestrator)가 한다.
 */
@Injectable()
export class SalesChannelClient {
  private readonly logger = new Logger(SalesChannelClient.name);
  private readonly pimBaseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pimBaseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  async getActiveSites(): Promise<string[]> {
    const internalKey = this.configService.get<string>('CORE_INTERNAL_KEY');
    if (!internalKey) {
      // 키 없이 부르면 401 이 돌아올 뿐이다. 원인이 드러나게 여기서 끊는다.
      throw new Error('CORE_INTERNAL_KEY 가 설정되지 않아 활성 판매채널을 조회할 수 없다.');
    }

    const response = await firstValueFrom(
      this.httpService.get<ActiveChannelSitesResponse>(`${this.pimBaseUrl}/internal/channels/active-sites`, {
        headers: { Authorization: `Bearer ${internalKey}` },
        timeout: 5000,
      }),
    );

    return response.data?.sites ?? [];
  }
}
