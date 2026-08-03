// product-import-job.worker → product-import-job.manager → product-import.manager →
// product-masters.service 가 '@packages/event-contracts' 를 bare specifier 로 import 한다.
// jest moduleNameMapper 는 서브패스(`@packages/event-contracts/*`)만 매핑하고 bare
// specifier 는 안 잡아준다 — product-import-job.manager.spec.ts 와 같은 이유로 여기도 필요하다.
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { ProductImportJobWorker } from './product-import-job.worker';
import { ClaimedSession } from './product-import-job.manager';

const LEASE_TOKEN = '0197f7a0-0000-7000-8000-000000000001';

function makeWorker(opts: { enabled?: string; claims?: Array<string | null> } = {}) {
  const sessionIds = opts.claims ?? [null];
  let i = 0;
  const jobManager = {
    claimImage: jest.fn(async (): Promise<ClaimedSession | null> => null),
    runImageSlice: jest.fn(async () => undefined),
    claimCommit: jest.fn(async (): Promise<ClaimedSession | null> => {
      const sessionId = sessionIds[Math.min(i++, sessionIds.length - 1)] ?? null;
      return sessionId ? { sessionId, leaseToken: LEASE_TOKEN } : null;
    }),
    runCommitSlice: jest.fn(async () => undefined),
    claimPublish: jest.fn(async (): Promise<ClaimedSession | null> => null),
    runPublishSlice: jest.fn(async () => undefined),
    recordJobError: jest.fn(async () => undefined),
    clearConsecutiveFailures: jest.fn(async () => undefined),
  } as any;
  const config = { get: jest.fn(() => opts.enabled) } as any;
  return { worker: new ProductImportJobWorker(jobManager, config), jobManager };
}

describe('ProductImportJobWorker', () => {
  it('클레임한 세션의 슬라이스를 돌린다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.runCommitSlice).toHaveBeenCalledWith({ sessionId: 'sess-1', leaseToken: LEASE_TOKEN });
  });

  it('클레임할 세션이 없으면 아무 것도 하지 않는다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });

    await worker.tick();

    expect(jobManager.runCommitSlice).not.toHaveBeenCalled();
    expect(jobManager.runPublishSlice).not.toHaveBeenCalled();
  });

  it('commit 대상이 없으면 publish 를 잡는다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });
    jobManager.claimPublish = jest.fn(async () => ({ sessionId: 'sess-2', leaseToken: 'tok-2' }));
    jobManager.runPublishSlice = jest.fn(async () => undefined);

    await worker.tick();

    expect(jobManager.runPublishSlice).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-2' }));
  });

  it('PRODUCT_IMPORT_WORKER_ENABLED=false 면 클레임조차 하지 않는다', async () => {
    const { worker, jobManager } = makeWorker({ enabled: 'false', claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.claimCommit).not.toHaveBeenCalled();
  });

  it('이전 틱이 아직 돌고 있으면 건너뛴다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    let release: () => void = () => {};
    jobManager.runCommitSlice.mockImplementation(() => new Promise<void>((r) => (release = r)));

    const first = worker.tick();
    // 이미지 레인 클레임이 커밋보다 먼저 도는 만큼(claimImage → claimCommit) 첫 틱이
    // runCommitSlice 의 대기 Promise 에 실제로 도달할 때까지 보류 중인 마이크로태스크를
    // 전부 비운다. 매크로태스크 경계(setImmediate)로 넘어가면 그 사이의 모든 await 체인이
    // 이미 실행된 뒤이므로, 두 번째 tick() 이 isProcessing 을 정확히 관찰한다 —
    // 그러지 않으면 아직 release 가 배정되기 전에 호출돼 테스트가 멈춘다.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await worker.tick();
    release();
    await first;

    expect(jobManager.claimCommit).toHaveBeenCalledTimes(1);
  });

  it('슬라이스가 터져도 예외를 밖으로 던지지 않는다 — 다음 틱이 이어간다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.runCommitSlice.mockRejectedValue(new Error('DB down'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('슬라이스가 터지면 클레임한 세션에 오류를 기록한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.runCommitSlice.mockRejectedValue(new Error('DB down'));

    await worker.tick();

    expect(jobManager.recordJobError).toHaveBeenCalledWith('sess-1', 'commit', 'DB down');
  });

  it('publish 슬라이스가 터지면 kind=publish 로 오류를 기록한다 — commit 으로 고정되면 안 된다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });
    jobManager.claimPublish = jest.fn(async () => ({ sessionId: 'sess-2', leaseToken: 'tok-2' }));
    jobManager.runPublishSlice = jest.fn(async () => {
      throw new Error('게시 실패');
    });

    await worker.tick();

    expect(jobManager.recordJobError).toHaveBeenCalledWith('sess-2', 'publish', '게시 실패');
  });

  it('슬라이스가 정상 종료하면 연속 실패를 리셋한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).toHaveBeenCalledWith('sess-1');
  });

  it('슬라이스가 터지면 리셋하지 않는다 — 리셋하면 상한이 영원히 안 걸린다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.runCommitSlice.mockRejectedValue(new Error('DB down'));

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).not.toHaveBeenCalled();
  });

  it('publish 슬라이스가 정상 종료해도 리셋한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });
    jobManager.claimPublish = jest.fn(async () => ({ sessionId: 'sess-2', leaseToken: 'tok-2' }));

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).toHaveBeenCalledWith('sess-2');
  });

  it('이미지 레인을 먼저 클레임하고, 잡으면 커밋을 시도하지 않는다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.claimImage.mockResolvedValue({ sessionId: 's-1', leaseToken: 't-1' });

    await worker.tick();

    expect(jobManager.runImageSlice).toHaveBeenCalledWith({ sessionId: 's-1', leaseToken: 't-1' });
    expect(jobManager.claimCommit).not.toHaveBeenCalled();
  });

  it('이미지 레인이 비면 커밋으로 넘어간다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.claimImage.mockResolvedValue(null);

    await worker.tick();

    expect(jobManager.runCommitSlice).toHaveBeenCalled();
  });

  it('이미지 슬라이스가 던지면 image kind 로 기록한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.claimImage.mockResolvedValue({ sessionId: 's-1', leaseToken: 't-1' });
    jobManager.runImageSlice.mockRejectedValue(new Error('boom'));

    await worker.tick();

    expect(jobManager.recordJobError).toHaveBeenCalledWith('s-1', 'image', 'boom');
  });
});
