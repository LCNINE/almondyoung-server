import { Injectable } from '@nestjs/common';
import { EventTraceReader, TraceLink } from './event-trace.reader';

export interface TraceResponse {
  links: TraceLink[];
  chainIds: string[];
  total: number;
}

export interface TraceResourceListResponse {
  resources: { resourceId: string }[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `/events/trace/*` 응답 정형. 라우팅·인증은 앱 소유다.
 *
 * 왜 컨트롤러가 여기 없는가 — 이 API 를 서빙하는 앱이 5개인데 전역 가드가 앱마다 다르다
 * (channel-adapter·notification = `AdminRealmGuard` 기본차단 / membership·user-service =
 * `ScopeGuard` 무표시 통과 / wallet = `WalletAuthGuard` API 키 요구). 라이브러리가 인증 표기를
 * 하나 고르면 세 갈래 중 둘이 깨진다. 실제로 옛 `EventTraceController` 는 `isPublic` 을 골랐고,
 * 그게 5개 앱 전부에서 인터넷 무인증 노출이 됐다 (#705).
 *
 * 그래서 컨트롤러는 각 앱이 자기 인가 데코레이터와 함께 선언하고, 앱마다 똑같을 조회·정형만
 * 여기 남긴다. 부수 효과로 `scripts/security/route-authz-audit.js` 의 `apps/` 스캔에 자동으로 잡힌다.
 */
@Injectable()
export class EventTraceQueryService {
  constructor(private readonly reader: EventTraceReader) {}

  /**
   * resourceType 에 속하는 리소스 목록 페이지네이션.
   *
   * limit/offset 은 쿼리스트링이라 문자열로 들어온다. 음수는 드리즐 쿼리에서 500 이 되므로
   * 여기서 잘라낸다 — 옛 컨트롤러는 상한만 걸고 하한이 없었다.
   */
  async listResourcesByType(
    resourceType: string,
    limitRaw?: string,
    offsetRaw?: string,
  ): Promise<TraceResourceListResponse> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(offsetRaw ?? '', 10) || 0, 0);

    const [resources, total] = await Promise.all([
      this.reader.findResourcesByType(resourceType, limit, offset),
      this.reader.countResourcesByType(resourceType),
    ]);

    return { resources, total, limit, offset };
  }

  /** 리소스에 연관된 모든 이벤트 링크 (그 리소스가 낀 체인 전체를 편다) */
  async byResource(resourceType: string, resourceId: string): Promise<TraceResponse> {
    const links = await this.reader.findByResource(resourceType, resourceId);
    const chainIds = [...new Set(links.map((l) => l.chainId))];
    return { links, chainIds, total: links.length };
  }

  /** chain 에 속하는 모든 이벤트 링크 */
  async byChain(chainId: string): Promise<TraceResponse> {
    const links = await this.reader.findByChain(chainId);
    return { links, chainIds: chainId ? [chainId] : [], total: links.length };
  }
}
