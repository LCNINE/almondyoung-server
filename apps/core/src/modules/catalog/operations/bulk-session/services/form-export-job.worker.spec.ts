import { FormExportJobWorker } from './form-export-job.worker';
import { ClaimedExport } from './form-export-job.manager';

/**
 * FormExportJobManager/FormExportManager 를 각각 jest.fn 필드 하나씩만 흉내낸 페이크로
 * 대체한다. `jobManager as FormExportJobManager` 처럼 통째로 인터페이스 타입을 씌우면
 * `expect(jobManager.runExport)...` 같은 메서드 참조가 `@typescript-eslint/unbound-method`
 * 에 걸린다(클래스 메서드로 보여 `this` 바인딩을 걱정하는 규칙) — jest.fn 참조를 낱개로
 * 돌려주고, 생성자에 넘길 때만 `as never` 로 좁힌다.
 */
function makeWorker(opts: { enabled?: string; claims?: Array<string | null>; removed?: number } = {}) {
  const exportIds = opts.claims ?? [null];
  let i = 0;
  const claim = jest.fn((): Promise<ClaimedExport | null> => {
    const exportId = exportIds[Math.min(i++, exportIds.length - 1)] ?? null;
    return Promise.resolve(exportId ? { exportId, leaseToken: 'tok-1' } : null);
  });
  // 기본값 true — "소유권을 유지한 채 정상 종료" 가 흔한 경로다. false 를 흉내내려면
  // 개별 테스트에서 runExport.mockResolvedValue(false) 로 덮어쓴다.
  const runExport = jest.fn((): Promise<boolean> => Promise.resolve(true));
  const recordJobError = jest.fn((): Promise<void> => Promise.resolve());
  const clearConsecutiveFailures = jest.fn((): Promise<void> => Promise.resolve());
  const purgeExpired = jest.fn((): Promise<number> => Promise.resolve(opts.removed ?? 0));
  // ConfigService 는 이 워커가 실제로 부르는 .get() 만 흉내내면 된다.
  const config = { get: jest.fn(() => opts.enabled) };

  const worker = new FormExportJobWorker(
    { claim, runExport, recordJobError, clearConsecutiveFailures } as never,
    { purgeExpired } as never,
    config as never,
  );
  return { worker, claim, runExport, recordJobError, clearConsecutiveFailures, purgeExpired };
}

describe('FormExportJobWorker.tick', () => {
  it('클레임한 잡을 조립한다', async () => {
    const { worker, runExport } = makeWorker({ claims: ['exp-1'] });

    await worker.tick();

    expect(runExport).toHaveBeenCalledWith({ exportId: 'exp-1', leaseToken: 'tok-1' });
  });

  it('클레임할 잡이 없으면 아무 것도 하지 않는다', async () => {
    const { worker, runExport } = makeWorker({ claims: [null] });

    await worker.tick();

    expect(runExport).not.toHaveBeenCalled();
  });

  it('FORM_EXPORT_WORKER_ENABLED=false 면 클레임조차 하지 않는다', async () => {
    const { worker, claim } = makeWorker({ enabled: 'false', claims: ['exp-1'] });

    await worker.tick();

    expect(claim).not.toHaveBeenCalled();
  });

  it('이전 틱이 아직 돌고 있으면 건너뛴다', async () => {
    const { worker, claim, runExport } = makeWorker({ claims: ['exp-1'] });
    let release: () => void = () => {};
    runExport.mockImplementation(() => new Promise<boolean>((r) => (release = () => r(true))));

    const first = worker.tick();
    // claim → runExport 의 대기 Promise 에 실제로 도달할 때까지 보류 중인 마이크로태스크를
    // 전부 비운다. 매크로태스크 경계(setImmediate)로 넘어가면 그 사이의 모든 await 체인이
    // 이미 실행된 뒤이므로, 두 번째 tick() 이 isProcessing 을 정확히 관찰한다.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await worker.tick();
    release();
    await first;

    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('조립이 터져도 예외를 밖으로 던지지 않는다 — 다음 틱이 이어간다', async () => {
    const { worker, runExport } = makeWorker({ claims: ['exp-1'] });
    runExport.mockRejectedValue(new Error('DB down'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });

  // 토큰을 같이 넘겨야 recordJobError 의 CAS 가 성립한다 — 토큰이 빠지면 좀비의 뒤늦은
  // 예외가 후임의 살아있는 잡의 lease 를 짧게 깎아 제3의 워커가 인수하고, 이중 조립·이중
  // 업로드로 진 쪽 xlsx 가 영구 고아가 된다.
  it('조립이 터지면 클레임한 잡에 lease 토큰과 함께 오류를 기록한다', async () => {
    const { worker, runExport, recordJobError } = makeWorker({ claims: ['exp-1'] });
    runExport.mockRejectedValue(new Error('DB down'));

    await worker.tick();

    expect(recordJobError).toHaveBeenCalledWith('exp-1', 'tok-1', 'DB down');
  });

  it('조립이 정상 종료하면 연속 실패를 리셋한다', async () => {
    const { worker, clearConsecutiveFailures } = makeWorker({ claims: ['exp-1'] });

    await worker.tick();

    expect(clearConsecutiveFailures).toHaveBeenCalledWith('exp-1');
  });

  it('조립이 터지면 리셋하지 않는다 — 리셋하면 상한이 영원히 안 걸린다', async () => {
    const { worker, runExport, clearConsecutiveFailures } = makeWorker({ claims: ['exp-1'] });
    runExport.mockRejectedValue(new Error('DB down'));

    await worker.tick();

    expect(clearConsecutiveFailures).not.toHaveBeenCalled();
  });

  // Important 3 회귀 방지: runExport 가 예외 없이 반환해도 owned:false 면(CAS 에서 lease
  // 를 잃음) 리셋하면 안 된다 — 그건 내(좀비) 상태가 아니라 후임의 살아있는 잡의
  // consecutive_failures 를 0 으로 되돌리는 것이다.
  it('조립이 성공했지만 소유권을 잃었으면(owned=false) 리셋하지 않는다', async () => {
    const { worker, runExport, clearConsecutiveFailures } = makeWorker({ claims: ['exp-1'] });
    runExport.mockResolvedValue(false);

    await worker.tick();

    expect(clearConsecutiveFailures).not.toHaveBeenCalled();
  });
});

describe('FormExportJobWorker.purge', () => {
  it('만료된 잡을 오늘 날짜로 정리한다', async () => {
    const { worker, purgeExpired } = makeWorker({ removed: 3 });

    await worker.purge();

    expect(purgeExpired).toHaveBeenCalledWith(expect.any(Date));
  });

  it('FORM_EXPORT_WORKER_ENABLED=false 면 정리도 건너뛴다', async () => {
    const { worker, purgeExpired } = makeWorker({ enabled: 'false' });

    await worker.purge();

    expect(purgeExpired).not.toHaveBeenCalled();
  });
});

/**
 * `@Cron` 데코레이터는 그 자체로는 아무 것도 하지 않는다 — 클래스가 Nest 컨테이너의
 * provider 로 등록돼야 `ScheduleModule` 의 `ScheduleExplorer`(discovery 로 전체 provider를
 * 훑는다)가 찾아 `SchedulerRegistry` 에 실제 cron job 으로 마운트한다. 이 스위트는 그
 * 배선이 실제로 동작하는지(브리프가 그렇다고 가정만 하고 검증하지 않은 지점) 실제
 * `@nestjs/schedule` 로 증명한다 — `.compile()` 만으로는 부족하고(onModuleInit/
 * onApplicationBootstrap 을 안 돈다) `.init()` 까지 불러야 ScheduleExplorer.explore() 와
 * SchedulerOrchestrator.mountCron() 이 실행된다.
 */
describe('FormExportJobWorker 크론 등록', () => {
  it('ScheduleModule.forRoot() 아래에서 tick·purge 두 크론잡이 실제로 마운트된다', async () => {
    const { Test } = await import('@nestjs/testing');
    const { ScheduleModule, SchedulerRegistry } = await import('@nestjs/schedule');
    const { ConfigService } = await import('@nestjs/config');
    const { FormExportJobManager } = await import('./form-export-job.manager');
    const { FormExportManager } = await import('./form-export.manager');

    const jobManager = { claim: jest.fn((): Promise<null> => Promise.resolve(null)) };
    const manager = { purgeExpired: jest.fn((): Promise<number> => Promise.resolve(0)) };

    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        FormExportJobWorker,
        { provide: FormExportJobManager, useValue: jobManager },
        { provide: FormExportManager, useValue: manager },
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();

    // .compile() 만으로는 onModuleInit 이 돌지 않으므로 아직 아무 것도 마운트되지 않았다.
    expect(moduleRef.get(SchedulerRegistry).getCronJobs().size).toBe(0);

    await moduleRef.init();

    expect(moduleRef.get(SchedulerRegistry).getCronJobs().size).toBe(2);

    await moduleRef.close();
  });
});
