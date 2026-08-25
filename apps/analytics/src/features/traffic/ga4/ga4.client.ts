import { Injectable, Logger } from '@nestjs/common';
import { BetaAnalyticsDataClient, protos } from '@google-analytics/data';

type RunReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/**
 * GA4 Data API 클라이언트 래퍼.
 *
 * env(GA4_SERVICE_ACCOUNT · GA4_PROPERTY_ID)가 없는 환경(로컬, env 배선 이전 배포)에서도
 * analytics 가 부팅되어야 하므로 클라이언트를 부팅 시점이 아니라 **첫 조회 시점에** 만든다.
 * env 부재는 에러가 아니라 `enabled=false` — 화면이 "연동 대기"를 보여줄 수 있게 한다.
 */
@Injectable()
export class Ga4Client {
  private readonly logger = new Logger(Ga4Client.name);
  private client: BetaAnalyticsDataClient | null = null;

  get enabled(): boolean {
    return Boolean(process.env.GA4_SERVICE_ACCOUNT && process.env.GA4_PROPERTY_ID);
  }

  /** sst 배선은 'properties/…' 원문을 넣지만, 숫자만 온 경우도 흡수한다. */
  get property(): string {
    const raw = process.env.GA4_PROPERTY_ID ?? '';
    return raw.startsWith('properties/') ? raw : `properties/${raw}`;
  }

  async runReport(request: Omit<RunReportRequest, 'property'>): Promise<RunReportResponse> {
    const [response] = await this.getClient().runReport({ ...request, property: this.property });
    return response;
  }

  private getClient(): BetaAnalyticsDataClient {
    if (this.client) return this.client;
    const raw = process.env.GA4_SERVICE_ACCOUNT ?? '';
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(raw);
    } catch (error) {
      // secret 이 잘려 들어오는 등 배선 사고 — 원문은 절대 로그에 남기지 않는다.
      this.logger.error(`GA4_SERVICE_ACCOUNT 파싱 실패 (길이 ${raw.length})`);
      throw error;
    }
    this.client = new BetaAnalyticsDataClient({ credentials });
    return this.client;
  }
}
