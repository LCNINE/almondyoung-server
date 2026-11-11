/**
 * 쿠팡 호출 속도 제한 — 프로세스당 초당 N회, 429 면 60초, 에러 폭주면 10분 멈춘다.
 *
 * 판매자 ID 한도가 초당 5회라, 롤링 배포로 태스크 둘이 겹쳐도 넘지 않게 프로세스당 2회로 둔다.
 * 에러 폭주는 «5초 안에 8건»이다 — 초당 2회면 한 프로세스가 5초에 많아야 10회라, 쿠팡의 IP 차단
 * 기준(5초 안 에러 20건)보다 낮아야 태스크 둘이 겹쳐도(합 16건) 차단 전에 멈춘다. 429 도 에러로 센다.
 */
export interface CoupangRateLimiterOptions {
  perSecond: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const WINDOW_MS = 1000;
const RATE_LIMITED_PAUSE_MS = 60_000;
const ERROR_WINDOW_MS = 5000;
const ERROR_BURST = 8;
const ERROR_BURST_PAUSE_MS = 600_000;

export class CoupangRateLimiter {
  private readonly perSecond: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly starts: number[] = [];
  private errors: number[] = [];
  private pausedUntil = 0;
  private calls = 0;

  constructor(opts: CoupangRateLimiterOptions) {
    this.perSecond = opts.perSecond;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      if (now < this.pausedUntil) {
        await this.sleep(this.pausedUntil - now);
        continue;
      }
      while (this.starts.length > 0 && this.starts[0] <= now - WINDOW_MS) this.starts.shift();
      if (this.starts.length < this.perSecond) {
        this.starts.push(now);
        this.calls++;
        return;
      }
      await this.sleep(this.starts[0] + WINDOW_MS - now);
    }
  }

  /** 이 프로세스에서 acquire 를 통과한(= 쿠팡에 보낸) 호출 수. 앞뒤로 읽어 한 주기의 호출 수를 낸다. */
  get callCount(): number {
    return this.calls;
  }

  recordRateLimited(): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + RATE_LIMITED_PAUSE_MS);
    this.recordError();
  }

  recordError(): void {
    const now = this.now();
    this.errors = this.errors.filter((t) => t > now - ERROR_WINDOW_MS);
    this.errors.push(now);
    if (this.errors.length >= ERROR_BURST) {
      this.pausedUntil = Math.max(this.pausedUntil, now + ERROR_BURST_PAUSE_MS);
      this.errors = [];
    }
  }

  recordSuccess(): void {
    // 에러 폭주 판정은 «5초 안의 건수» 라 성공이 끼어도 지우지 않는다.
  }
}

export const coupangRateLimiter = new CoupangRateLimiter({ perSecond: 2 });
