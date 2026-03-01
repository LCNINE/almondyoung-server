import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AlmondAuthClient {
  private readonly logger = new Logger(AlmondAuthClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getBaseUrl(): string {
    return this.configService.get<string>('ALMOND_AUTH_URL') || '';
  }

  /**
   * 활성 멤버십 회원 중 Cafe24 연동된 회원의 cafe24MemberId 목록 반환
   * GET /member/active-cafe24-members
   */
  async getActiveCafe24Members(): Promise<string[]> {
    const url = `${this.getBaseUrl()}/member/active-cafe24-members`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ success: boolean; data: { members: { cafe24MemberId: string }[] } }>(url),
      );
      const members = response.data?.data?.members ?? [];
      return members.map((m) => m.cafe24MemberId);
    } catch (error) {
      this.logger.error(`getActiveCafe24Members 실패: ${error?.message}`);
      throw error;
    }
  }

  /**
   * Cafe24 회원 ID로 멤버십 활성 여부 조회
   * GET /member/cafe24/subscription/:cafe24MemberId
   */
  async getMembershipStatus(cafe24MemberId: string): Promise<boolean> {
    const url = `${this.getBaseUrl()}/member/cafe24/subscription/${encodeURIComponent(cafe24MemberId)}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ success: boolean; data: { active: boolean } }>(url),
      );
      return response.data?.data?.active ?? false;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404) {
        return false;
      }
      this.logger.error(`getMembershipStatus 실패 (cafe24MemberId=${cafe24MemberId}): ${error?.message}`);
      throw error;
    }
  }
}
