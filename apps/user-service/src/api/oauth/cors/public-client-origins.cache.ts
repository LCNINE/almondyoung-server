import { Injectable, Logger } from '@nestjs/common';
import {
  collectPublicClientOrigins,
  isPublicClientOriginAllowed,
  type PublicClientOrigins,
} from './public-client-cors';
import { PublicClientOriginsRepository } from './public-client-origins.repository';

const TTL_MS = 60_000;

/**
 * 공개 OAuth 클라이언트의 웹 origin 목록. CORS 판정이 요청마다 DB 를 치지 않게 60초 캐시한다.
 * admin API 가 클라이언트를 고치면 invalidate() 로 이 태스크의 캐시만 비운다 —
 * 다른 ECS 태스크는 TTL 이 지나야 반영된다.
 */
@Injectable()
export class PublicClientOriginsCache {
  private readonly logger = new Logger(PublicClientOriginsCache.name);
  private cached: { origins: PublicClientOrigins; loadedAt: number } | null = null;
  private inflight: Promise<PublicClientOrigins> | null = null;
  private generation = 0;

  constructor(private readonly repository: PublicClientOriginsRepository) {}

  async isAllowed(origin: string): Promise<boolean> {
    return isPublicClientOriginAllowed(origin, await this.get());
  }

  invalidate(): void {
    this.cached = null;
    this.inflight = null;
    this.generation += 1;
  }

  private async get(): Promise<PublicClientOrigins> {
    if (this.cached && Date.now() - this.cached.loadedAt < TTL_MS) return this.cached.origins;
    this.inflight ??= this.load();
    return this.inflight;
  }

  private async load(): Promise<PublicClientOrigins> {
    const generation = this.generation;
    try {
      const origins = collectPublicClientOrigins(await this.repository.findOriginSources());
      // 조회 도중 invalidate 됐으면 옛 결과로 캐시를 덮지 않는다.
      if (generation === this.generation) this.cached = { origins, loadedAt: Date.now() };
      return origins;
    } catch (error) {
      // DB 가 잠깐 안 될 때는 마지막으로 읽은 목록을 계속 쓴다. 없으면 호출자가 기존 규칙으로 물러난다.
      if (this.cached) {
        this.logger.warn(`공개 클라이언트 origin 재조회 실패 — 이전 목록 유지: ${String(error)}`);
        return this.cached.origins;
      }
      throw error;
    } finally {
      if (generation === this.generation) this.inflight = null;
    }
  }
}
