import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ServiceUnavailableError, UpstreamUnavailableError } from '@app/shared';

/** 명단은 한 번에 온다(페이지 없음). */
const TIMEOUT_MS = 30_000;

/** membership 의 회원 명단(SSOT). 알림톡 대상 «멤버십 회원만»·«미납 회원만» 에 쓴다. */
@Injectable()
export class MembershipAudienceClient {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async activeUserIds(): Promise<Set<string>> {
    const data = await this.post<{ activeUserIds?: string[] }>('active-all', '멤버십 회원 명단');
    return new Set(data?.activeUserIds ?? []);
  }

  /** 미납 요금이 남은 계정. 가입 관문과 같은 기준을 membership 이 계산한다. */
  async arrearsUserIds(): Promise<Set<string>> {
    const data = await this.post<{ userIds?: string[] }>('arrears-outstanding', '미납 회원 명단');
    return new Set(data?.userIds ?? []);
  }

  private async post<T>(path: string, what: string): Promise<T | undefined> {
    const baseUrl = this.configService.get<string>('MEMBERSHIP_SERVICE_URL');
    const key = this.configService.get<string>('MEMBERSHIP_INTERNAL_KEY');
    if (!baseUrl || !key)
      throw new ServiceUnavailableError('멤버십 서비스 주소가 설정되지 않아 멤버십 회원을 고를 수 없습니다');
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(
          `${baseUrl}/internal/memberships/${path}`,
          {},
          { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS },
        ),
      );
      return response.data;
    } catch (error) {
      throw new UpstreamUnavailableError(
        `${what}을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
