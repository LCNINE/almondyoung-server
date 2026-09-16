import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { DEFAULT_PRODUCTS_INDEX } from './types/product-document.type';
import { DEFAULT_QUERY_EVENTS_INDEX } from './types/query-keyword-document.type';

// ALB 헬스체크 타임아웃이 5초다. 그 안에 여유를 두고 끝나야 판정이 «앱이 살아있나»로 남는다.
export const PING_TIMEOUT_MS = 1000;

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      this.configService.get<string>('ELASTICSEARCH_NODE') ||
      'http://localhost:9200';
    const username =
      this.configService.get<string>('OPENSEARCH_USERNAME') || this.configService.get<string>('ELASTICSEARCH_USERNAME');
    const password =
      this.configService.get<string>('OPENSEARCH_PASSWORD') || this.configService.get<string>('ELASTICSEARCH_PASSWORD');

    this.client = new Client({
      node,
      auth: username && password ? { username, password } : undefined,
    });

    this.logger.log(`OpenSearch client configured with node: ${node}`);
  }

  // 부팅 시 연결 확인은 «로그»지 «관문»이 아니다. 여기서 throw 하면 OpenSearch 의 가용성이
  // 그대로 이 프로세스의 가용성이 되고, 검색과 무관한 라우트(키워드 운영 상태 = search DB)까지
  // 같이 죽는다. 게다가 이 앱은 notification·ugc 와 한 ECS 태스크를 쓰므로 포트 하나가
  // unhealthy 해지면 태스크 «전체»가 교체돼 멀쩡한 두 앱까지 재시작된다.
  // (2026-09-16: 외부 OpenSearch 28분 다운 → 무한 재시작 → 고객 검색 전면 0건.)
  // 이 상태는 /health 가 200 + status:'degraded' 로 알린다 — 프로세스는 살아서 요청을 받는다.
  async onModuleInit(): Promise<void> {
    try {
      const health = await this.client.cluster.health({}, { requestTimeout: PING_TIMEOUT_MS, maxRetries: 0 });
      this.logger.log(`OpenSearch connected: ${health.body.status}`);
    } catch (error) {
      this.logger.error(
        'Failed to connect to OpenSearch — 검색 경로는 실패하지만 부팅은 계속한다',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  getClient(): Client {
    return this.client;
  }

  getProductsIndex(): string {
    return this.configService.get<string>('SEARCH_PRODUCTS_INDEX') || DEFAULT_PRODUCTS_INDEX;
  }

  getQueryEventsIndex(): string {
    return this.configService.get<string>('SEARCH_QUERY_EVENTS_INDEX') || DEFAULT_QUERY_EVENTS_INDEX;
  }

  // /health 가 쓰는 확인이라 «빨리» 답해야 한다. 클라이언트 기본값은 요청 30초 + 재시도 3회라,
  // OpenSearch 가 거절이 아니라 «먹통»(연결은 되는데 응답이 없음)이면 /health 가 그만큼 끌려가
  // ALB 헬스체크 5초를 넘긴다 — 부팅에서 안 죽게 고쳐 놔도 결국 같은 태스크 교체로 돌아간다.
  async ping(): Promise<boolean> {
    try {
      await this.client.ping({}, { requestTimeout: PING_TIMEOUT_MS, maxRetries: 0 });
      return true;
    } catch {
      return false;
    }
  }
}
