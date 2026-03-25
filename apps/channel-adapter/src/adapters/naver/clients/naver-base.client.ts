import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

/**
 * 네이버 API 클라이언트들의 기본 클래스.
 * 공통 로직 (Logger, HttpService, BaseUrl)을 처리합니다.
 */
export abstract class NaverBaseClient {
  protected readonly logger: Logger;
  protected readonly apiBaseUrl: string;

  /**
   * @param http NestJS HttpService
   * @param loggerName 이 클라이언트를 상속받는 클래스의 이름 (Logger 컨텍스트용)
   */
  constructor(
    protected readonly http: HttpService,
    loggerName: string,
  ) {
    // 자식 클래스의 이름을 받아 Logger를 생성합니다.
    this.logger = new Logger(loggerName);
    this.apiBaseUrl = this.getApiBaseUrl();
  }

  /**
   * API Base URL을 환경에 따라 결정합니다.
   * (기존 NaverCommerceApiService.getApiBaseUrl() 로직과 동일)
   */
  private getApiBaseUrl(): string {
    // Mock 서버 사용 시
    if (process.env.NAVER_USE_MOCK_SERVER === 'true') {
      const mockUrl = process.env.ADAPTER_MOCK_BASE_URL || 'http://localhost:3001';
      this.logger.log(`🔧 네이버 Mock 서버 사용: ${mockUrl}`);
      return `${mockUrl}/naver`;
    }

    // 실제 네이버 API 사용
    return process.env.NAVER_API_ENDPOINT || '';
  }
}
