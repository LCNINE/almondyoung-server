// (Task 8) `BulkSessionJobWorker` → `BulkSessionJobManager` → `BulkDraftApplier` →
// `product-masters.service.ts` 가 bare `@packages/event-contracts` 를 import 한다 — 루트 jest
// 설정의 moduleNameMapper 에는 하위 경로만 있고 bare 경로 항목이 없어 해석되지 않는다(레포
// 상시 debt). 레포 선례(bulk-draft.applier.spec.ts)와 같은 모양으로 가상 모듈을 세운다.
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { Logger } from '@nestjs/common';
import { BulkSessionJobWorker } from './bulk-session-job.worker';
import { ClaimedBulkSession } from './bulk-session-job.manager';

/**
 * BulkSessionJobManager 를 jest.fn 필드 하나씩만 흉내낸 페이크로 대체한다. 통째로
 * 인터페이스 타입을 씌우면 `expect(jobManager.runParseSlice)...` 같은 메서드 참조가
 * `@typescript-eslint/unbound-method` 에 걸린다 — form-export-job.worker.spec.ts 와 같은
 * 이유로 jest.fn 참조를 낱개로 돌려주고, 생성자에 넘길 때만 `as never` 로 좁힌다.
 */
function makeWorker(opts: { enabled?: string; claimed?: ClaimedBulkSession | null } = {}) {
  const claimed = opts.claimed === undefined ? null : opts.claimed;
  const claim = jest.fn((): Promise<ClaimedBulkSession | null> => Promise.resolve(claimed));
  const runParseSlice = jest.fn((): Promise<void> => Promise.resolve());
  const runValidateSlice = jest.fn((): Promise<void> => Promise.resolve());
  const runDraftSlice = jest.fn((): Promise<void> => Promise.resolve());
  const recordJobError = jest.fn((): Promise<void> => Promise.resolve());
  const clearConsecutiveFailures = jest.fn((): Promise<void> => Promise.resolve());
  const config = { get: jest.fn(() => opts.enabled) };

  const worker = new BulkSessionJobWorker(
    { claim, runParseSlice, runValidateSlice, runDraftSlice, recordJobError, clearConsecutiveFailures } as never,
    config as never,
  );
  return { worker, claim, runParseSlice, runValidateSlice, runDraftSlice, recordJobError, clearConsecutiveFailures };
}

const UPLOADED: ClaimedBulkSession = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'uploaded' };
const VALIDATING: ClaimedBulkSession = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'validating' };
const DRAFTING: ClaimedBulkSession = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'drafting' };

describe('BulkSessionJobWorker.tick', () => {
  it('uploaded 를 잡으면 파싱 슬라이스를 돈다', async () => {
    const { worker, runParseSlice, runValidateSlice } = makeWorker({ claimed: UPLOADED });

    await worker.tick();

    expect(runParseSlice).toHaveBeenCalledWith(UPLOADED);
    expect(runValidateSlice).not.toHaveBeenCalled();
  });

  it('validating 을 잡으면 검증 슬라이스를 돈다', async () => {
    const { worker, runParseSlice, runValidateSlice } = makeWorker({ claimed: VALIDATING });

    await worker.tick();

    expect(runValidateSlice).toHaveBeenCalledWith(VALIDATING);
    expect(runParseSlice).not.toHaveBeenCalled();
  });

  it("phase 가 'drafting' 이면 runDraftSlice 를 부른다", async () => {
    const { worker, runParseSlice, runValidateSlice, runDraftSlice } = makeWorker({ claimed: DRAFTING });

    await worker.tick();

    expect(runDraftSlice).toHaveBeenCalledTimes(1);
    expect(runDraftSlice).toHaveBeenCalledWith(DRAFTING);
    expect(runValidateSlice).not.toHaveBeenCalled();
    expect(runParseSlice).not.toHaveBeenCalled();
  });

  it('슬라이스가 예외 없이 끝나면 연속 실패를 리셋한다', async () => {
    const { worker, clearConsecutiveFailures } = makeWorker({ claimed: VALIDATING });

    await worker.tick();

    // 리셋이 없으면 산발적 오류가 누적돼 멀쩡한 세션이 언젠가 상한에 닿아 failed 가 된다.
    expect(clearConsecutiveFailures).toHaveBeenCalledWith('sess-1');
  });

  it('클레임할 세션이 없으면 아무 것도 하지 않는다', async () => {
    const { worker, runParseSlice, runValidateSlice, clearConsecutiveFailures } = makeWorker({ claimed: null });

    await worker.tick();

    expect(runParseSlice).not.toHaveBeenCalled();
    expect(runValidateSlice).not.toHaveBeenCalled();
    expect(clearConsecutiveFailures).not.toHaveBeenCalled();
  });

  it('PRODUCT_BULK_SESSION_WORKER_ENABLED=false 면 클레임조차 하지 않는다', async () => {
    const { worker, claim } = makeWorker({ enabled: 'false', claimed: UPLOADED });

    await worker.tick();

    expect(claim).not.toHaveBeenCalled();
  });

  it('슬라이스가 예외 없이 끝나야만 연속 실패를 리셋한다', async () => {
    const { worker, runValidateSlice, recordJobError, clearConsecutiveFailures } = makeWorker({ claimed: VALIDATING });
    runValidateSlice.mockRejectedValueOnce(new Error('DB 커넥션 끊김'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      await worker.tick();
    } finally {
      errorSpy.mockRestore();
    }

    // 리셋을 catch 에서 부르면 연속 실패 상한이 영원히 발화하지 못한다.
    expect(clearConsecutiveFailures).not.toHaveBeenCalled();
    expect(recordJobError).toHaveBeenCalledWith('sess-1', 'DB 커넥션 끊김');
  });

  it('이전 틱이 아직 돌고 있으면 건너뛴다', async () => {
    const { worker, claim, runValidateSlice } = makeWorker({ claimed: VALIDATING });
    let release: () => void = () => {};
    runValidateSlice.mockImplementation(() => new Promise<void>((r) => (release = () => r())));

    const first = worker.tick();
    // claim → runValidateSlice 의 대기 Promise 에 실제로 도달할 때까지 보류 중인
    // 마이크로태스크를 전부 비운다(form-export-job.worker.spec.ts 와 같은 기법).
    await new Promise<void>((resolve) => setImmediate(resolve));
    await worker.tick();

    expect(claim).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
