const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 프로세스 안에서 호출 사이 간격을 최소 `intervalMs` 로 벌리는 페이서.
 *
 * 슬롯은 `acquire()` 가 await 에 들어가기 **전에** 동기적으로 예약된다 — 동시 호출자들이 같은
 * 슬롯을 받아 순간 TPS 가 호출자 수만큼 뛰는 일이 없다.
 *
 * 태스크 간 조율은 하지 않는다(core 엔 Redis 가 없다). 여러 태스크가 같은 API 를 동시에 부르지
 * 않는 것은 호출자 쪽 규율이다 — 추적 폴러는 `@CronOnce` 로 주기당 한 태스크에서만 돈다.
 */
export class IntervalPacer {
  private nextAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async acquire(): Promise<void> {
    const now = this.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.intervalMs;
    if (at > now) await this.sleep(at - now);
  }
}
