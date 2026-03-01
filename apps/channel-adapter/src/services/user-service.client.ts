import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface Cafe24LinkInfo {
  userId: string;
  email: string;
}

export interface Cafe24LinkEntry {
  userId: string;
  cafe24MemberId: string;
  email: string;
}

@Injectable()
export class UserServiceClient {
  private readonly logger = new Logger(UserServiceClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getBaseUrl(): string {
    return this.configService.get<string>('USER_SERVICE_URL') || '';
  }

  private getMallId(): string {
    return 'lcnine';
  }

  /**
   * Cafe24 회원 ID로 userId + email 조회
   * GET /cafe24/internal/link-info?mallId=lcnine&cafe24MemberId=xxx
   */
  async getLinkInfo(cafe24MemberId: string): Promise<Cafe24LinkInfo | null> {
    const mallId = this.getMallId();
    const url = `${this.getBaseUrl()}/cafe24/internal/link-info?mallId=${encodeURIComponent(mallId)}&cafe24MemberId=${encodeURIComponent(cafe24MemberId)}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<Cafe24LinkInfo>(url),
      );
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404) {
        return null;
      }
      this.logger.error(`getLinkInfo 실패 (cafe24MemberId=${cafe24MemberId}): ${error?.message}`);
      throw error;
    }
  }

  /**
   * 전체 연동 목록 조회 (unlinkedAt IS NULL)
   * GET /cafe24/internal/links?mallId=lcnine
   */
  async getAllLinks(): Promise<Cafe24LinkEntry[]> {
    const mallId = this.getMallId();
    const url = `${this.getBaseUrl()}/cafe24/internal/links?mallId=${encodeURIComponent(mallId)}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<Cafe24LinkEntry[]>(url),
      );
      return response.data ?? [];
    } catch (error) {
      this.logger.error(`getAllLinks 실패: ${error?.message}`);
      throw error;
    }
  }
}
