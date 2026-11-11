import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { parseCoupangJson, stringifyCoupangJson } from './coupang-json';
import { coupangRateLimiter } from './coupang-rate-limiter';

/** 쿠팡 요청 하나의 상한. axios 기본(0)은 영원히 기다려 폴링 주기가 겹쳐 쌓인다. */
const REQUEST_TIMEOUT_MS = 30_000;

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
      const mockUrl = process.env.ADAPTER_MOCK_BASE_URL || 'http://localhost:3001';
      this.logger.log(`🔧 쿠팡 Mock 서버 사용: ${mockUrl}`);
      return `${mockUrl}/coupang`;
    }

    // 실제 쿠팡 API 사용
    return process.env.COUPANG_API_ENDPOINT || 'https://api-gateway.coupang.com';
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
    const datetime = new Date().toISOString().slice(2, 19).replace(/:/g, '').replace(/-/g, '') + 'Z';

    const message = datetime + method + path + queryString;
    const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');

    return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
  }

  /**
   * 쿠팡 호출의 단일 통로 — 속도 제한 → 읽기 전용 검사 → 서명 → 전송 → 손실 없는 JSON 파싱.
   *
   * `COUPANG_READ_ONLY=true` 면 GET 이 아닌 호출은 보내기 전에 throw 한다(호출 시점에 읽는다).
   * HTTP 오류는 상태 코드를 메시지(`쿠팡 <status>: …`)와 `status` 속성에 싣고 throw 한다.
   * 요청은 30초에 끊는다 — timeout 도 에러로 세고(속도 제한의 에러 폭주), 메시지에 메서드·경로를 싣는다.
   */
  protected async send<T>(
    method: 'GET' | 'PATCH' | 'POST' | 'PUT',
    path: string,
    options: { query?: URLSearchParams; body?: unknown } = {},
  ): Promise<T> {
    await coupangRateLimiter.acquire();

    if (process.env.COUPANG_READ_ONLY === 'true' && method !== 'GET') {
      throw new Error(`COUPANG_READ_ONLY: ${method} ${path} 차단`);
    }

    const config = this.getApiConfig();
    const queryString = options.query?.toString() ?? '';
    const authorization = this.generateAuthHeader(config.accessKey, config.secretKey, method, path, queryString);
    const url = `${config.apiEndpoint}${path}${queryString ? `?${queryString}` : ''}`;

    let status: number | undefined;
    let text: string;
    try {
      const response = await firstValueFrom(
        this.http.request<string>({
          method,
          url,
          data: options.body === undefined ? undefined : stringifyCoupangJson(options.body),
          responseType: 'text',
          timeout: REQUEST_TIMEOUT_MS,
          transformResponse: [(data: string) => data],
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        }),
      );
      status = response.status;
      text = response.data;
    } catch (error) {
      const failedStatus = statusOf(error);
      if (failedStatus === 429) coupangRateLimiter.recordRateLimited();
      else coupangRateLimiter.recordError();
      throw Object.assign(new Error(failureMessage(error, failedStatus, `${method} ${path}`)), {
        status: failedStatus,
        cause: error,
      });
    }

    coupangRateLimiter.recordSuccess();
    this.logger.debug?.(`쿠팡 ${method} ${path} → ${status}`);
    return parseCoupangJson(text) as T;
  }
}

function failureMessage(error: unknown, status: number | undefined, call: string): string {
  if (status !== undefined) return `쿠팡 ${status}: ${brief(responseTextOf(error))}`;
  if (isTimeout(error)) return `쿠팡 시간 초과(${REQUEST_TIMEOUT_MS}ms): ${call}`;
  return `쿠팡 네트워크: ${call} — ${messageOf(error)}`;
}

/** axios 는 timeout 을 `ECONNABORTED`(구버전)·`ETIMEDOUT`(transitional.clarifyTimeoutError) 로 낸다 */
function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

function responseTextOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) return '';
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('data' in response)) return '';
  return typeof response.data === 'string' ? response.data : '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 오류 본문은 길 수 있고 고객 정보가 섞일 수 있어 앞부분만 싣는다 */
function brief(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
