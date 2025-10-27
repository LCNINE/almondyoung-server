import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as crypto from 'crypto';

/**
 * 쿠팡 API 기본 설정 정보
 */
export interface CoupangApiConfig {
  vendorId: string;
  accessKey: string;
  secretKey: string;
  apiEndpoint: string;
}

/**
 * 쿠팡 API 클라이언트 Base 클래스
 *
 * 모든 쿠팡 클라이언트 서비스의 부모 클래스로,
 * 공통 기능(인증, 설정, URL 관리)을 제공합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */
export abstract class CoupangBaseClient {
  protected readonly logger: Logger;
  protected readonly apiBaseUrl: string;

  constructor(protected readonly http: HttpService) {
    this.logger = new Logger(this.constructor.name);
    this.apiBaseUrl = this.getApiBaseUrl();
  }

  /**
   * API Base URL을 환경에 따라 결정합니다
   */
  protected getApiBaseUrl(): string {
    // Mock 서버 사용 시
    if (process.env.COUPANG_USE_MOCK_SERVER === 'true') {
      const mockUrl =
        process.env.ADAPTER_MOCK_BASE_URL || 'http://localhost:3001';
      this.logger.log(`🔧 쿠팡 Mock 서버 사용: ${mockUrl}`);
      return `${mockUrl}/coupang`;
    }

    // 실제 쿠팡 API 사용
    return (
      process.env.COUPANG_API_ENDPOINT || 'https://api-gateway.coupang.com'
    );
  }

  /**
   * 환경변수에서 쿠팡 API 설정을 가져옵니다
   * @returns 쿠팡 API 설정 정보
   */
  protected getApiConfig(): CoupangApiConfig {
    const vendorId = process.env.COUPANG_VENDOR_ID;
    const accessKey = process.env.COUPANG_ACCESS_KEY;
    const secretKey = process.env.COUPANG_SECRET_KEY;
    const apiEndpoint = this.apiBaseUrl;

    if (!vendorId || !accessKey || !secretKey) {
      throw new Error('쿠팡 API 인증 정보가 설정되지 않았습니다');
    }

    return { vendorId, accessKey, secretKey, apiEndpoint };
  }

  /**
   * 쿠팡 API 인증 헤더 생성 (쿠팡 공식 Node 예제 기반)
   */
  protected generateAuthHeader(
    accessKey: string,
    secretKey: string,
    method: string,
    path: string,
    queryString: string = '',
  ): string {
    const datetime =
      new Date()
        .toISOString()
        .slice(2, 19)
        .replace(/:/g, '')
        .replace(/-/g, '') + 'Z';

    const message = datetime + method + path + queryString;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(message)
      .digest('hex');

    return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
  }
}
