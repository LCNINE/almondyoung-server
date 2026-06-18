import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MembershipServiceClient {
  private readonly logger = new Logger(MembershipServiceClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getBaseUrl(): string {
    return this.configService.get<string>('MEMBERSHIP_SERVICE_URL') || '';
  }

  /**
   * 멤버십 서비스 internal grant 엔드포인트 호출.
   * 이미 활성 구독이 있으면 멤버십 서비스가 no-op으로 처리한다.
   */
  async grantIfNoActiveMembership(userId: string, days: number, memo: string): Promise<{ granted: boolean }> {
    const url = `${this.getBaseUrl()}/internal/grant`;
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ granted: boolean; reason?: string }>(url, { userId, days, memo }),
      );
      return { granted: response.data?.granted ?? false };
    } catch (error) {
      this.logger.error(`grantIfNoActiveMembership 실패 (userId=${userId}): ${error?.message}`);
      throw error;
    }
  }
}
