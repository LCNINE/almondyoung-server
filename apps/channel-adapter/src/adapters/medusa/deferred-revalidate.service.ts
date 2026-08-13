import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorefrontRevalidateService } from './storefront-revalidate.service';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

/**
 * 대량등록 중의 storefront 캐시 무효화를 모아서 한 번에 친다.
 *
 * 단건 경로는 상품마다 즉시 무효화하는데, 그 라우트는 호출마다 전역 목록 태그와
 * 모든 카테고리 페이지를 지운다. 대량등록이 그걸 상품 수만큼 부르면 캐시가 데워질
 * 틈이 없다 (실측: 5시간에 770회). 여기 모았다가 주기마다 1회만 친다.
 *
 * 버퍼는 인메모리다. 프로세스가 죽으면 그 주기분은 유실되고, 해당 상품은 캐시 TTL
 * (1시간) 까지 낡은 채로 남는다. 가격·재고가 아니라 캐시라 이 정도는 허용한다.
 */
@Injectable()
export class DeferredRevalidateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeferredRevalidateService.name);
  private readonly pending = new Set<string>();
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storefrontRevalidate: StorefrontRevalidateService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string | number | undefined>('DEFERRED_REVALIDATE_FLUSH_MS');
    const parsed = Number(raw);
    this.flushIntervalMs =
      raw === undefined || raw === null || raw === '' || !Number.isInteger(parsed) || parsed < 1000
        ? DEFAULT_FLUSH_INTERVAL_MS
        : parsed;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.logger.log(`Deferred revalidate started (flushIntervalMs=${this.flushIntervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 이 앱은 app.enableShutdownHooks() 를 호출하지 않는다 (main.ts) — 즉 onModuleDestroy 는
    // app.close() 가 실제로 불릴 때만 실행된다 (지금은 테스트뿐). ECS 배포로 인한 task
    // replacement 는 SIGTERM 을 프로세스에 보낼 뿐 app.close() 를 거치지 않으므로, 그 경로에서는
    // 여기 도달하지 못하고 버퍼가 유실된다. 최악의 경우도 flush 주기 1회분의
    // pim-detail-{handle} 무효화가 늦어지는 것뿐이며, 1시간 캐시 TTL 로 자연 치유된다.
    await this.flush();
  }

  enqueue(handle: string): void {
    this.pending.add(handle);
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    // 먼저 비운다 — 실패해도 다음 주기를 오염시키지 않는다. 최악은 캐시가 TTL 까지 낡는 것.
    const handles = [...this.pending];
    this.pending.clear();

    try {
      // revalidateProducts()(→ StorefrontRevalidateService.post())는 모든 에러를 삼킨다.
      // 즉 이 catch 는 프로덕션에서 사실상 도달하지 않고, 아래 로그는 "성공"이 아니라
      // "시도했다"만 의미한다 — 배포 후 재측정은 이 로그를 그렇게 읽어야 한다.
      await this.storefrontRevalidate.revalidateProducts(handles);
      this.logger.log(`Deferred revalidate dispatched: ${handles.length} handles`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Deferred revalidate flush failed (${handles.length} handles): ${message}`);
    }
  }
}
