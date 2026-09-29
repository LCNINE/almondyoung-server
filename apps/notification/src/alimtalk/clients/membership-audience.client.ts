import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ServiceUnavailableError, UpstreamUnavailableError } from '@app/shared';

/** 활성 멤버십 전원은 한 번에 온다(페이지 없음). */
const TIMEOUT_MS = 30_000;

/** membership 의 활성 멤버십 명단(SSOT). 알림톡 대상 «멤버십 회원만» 에 쓴다. */
@Injectable()
export class MembershipAudienceClient {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async activeUserIds(): Promise<Set<string>> {
    const baseUrl = this.configService.get<string>('MEMBERSHIP_SERVICE_URL');
    const key = this.configService.get<string>('MEMBERSHIP_INTERNAL_KEY');
    if (!baseUrl || !key)
      throw new ServiceUnavailableError('멤버십 서비스 주소가 설정되지 않아 멤버십 회원을 고를 수 없습니다');
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ activeUserIds?: string[] }>(
          `${baseUrl}/internal/memberships/active-all`,
          {},
          { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS },
        ),
      );
      return new Set(response.data?.activeUserIds ?? []);
    } catch (error) {
      throw new UpstreamUnavailableError(
        `멤버십 회원 명단을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
