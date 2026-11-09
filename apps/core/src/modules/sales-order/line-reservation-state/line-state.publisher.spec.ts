import type { DatabaseRun } from '@app/db';
import { LINE_STATE_PUBLISH_BATCH, LineStatePublisher } from './line-state.publisher';

/**
 * 폴러 루프 (#1247). 배치 하나의 DB 동작은 `line-state.publisher.integration.spec.ts`·`line-state-dirty.integration.spec.ts` 가 본다.
 */
function makePublisher(keys: Array<string | undefined>) {
  const visited: Array<string | undefined> = [];
  const dbService = {
    forEachDatabase: jest.fn(async <T>(fn: (key: string | undefined) => Promise<T>) => {
      const runs: DatabaseRun<T>[] = [];
      for (const key of keys) {
        visited.push(key);
        try {
          runs.push({ key, ok: true, value: await fn(key) });
        } catch (error) {
          runs.push({ key, ok: false, error });
        }
      }
      return runs;
    }),
    run: jest.fn(),
  };
  const enqueue = jest.fn();
  const publisher = new LineStatePublisher(dbService as never, { enqueue } as never);
  return { publisher, dbService, visited, enqueue };
}

describe('LineStatePublisher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('배치가 한도보다 작아질 때까지 이어 돈다', async () => {
    const { publisher } = makePublisher([undefined]);
    const batch = jest
      .spyOn(publisher, 'publishBatch')
      .mockResolvedValueOnce(LINE_STATE_PUBLISH_BATCH)
      .mockResolvedValueOnce(LINE_STATE_PUBLISH_BATCH)
      .mockResolvedValueOnce(3);

    await expect(publisher.drainCurrentDatabase(Date.now() + 60_000)).resolves.toBe(LINE_STATE_PUBLISH_BATCH * 2 + 3);
    expect(batch).toHaveBeenCalledTimes(3);
  });

  it('더러운 주문이 없으면 배치 한 번으로 끝나고 enqueue 는 없다', async () => {
    const { publisher, enqueue } = makePublisher([undefined]);
    const batch = jest.spyOn(publisher, 'publishBatch').mockResolvedValue(0);

    await expect(publisher.drainCurrentDatabase(Date.now() + 60_000)).resolves.toBe(0);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('시간 한도가 지나면 배치가 가득 차도 멈춘다 — 그래도 한 배치는 돈다', async () => {
    const { publisher } = makePublisher([undefined]);
    const batch = jest.spyOn(publisher, 'publishBatch').mockResolvedValue(LINE_STATE_PUBLISH_BATCH);

    await expect(publisher.drainCurrentDatabase(Date.now() - 1)).resolves.toBe(LINE_STATE_PUBLISH_BATCH);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('tick 은 DB 마다 돌고, 한 DB 의 실패가 다른 DB 를 막지 않는다', async () => {
    const { publisher, visited } = makePublisher(['1', '2']);
    jest.spyOn(publisher, 'publishBatch').mockRejectedValueOnce(new Error('DB 1 깨짐')).mockResolvedValueOnce(1);
    const logged = jest.spyOn(publisher['logger'], 'error').mockImplementation(() => undefined);

    await publisher.tick();

    expect(visited).toEqual(['1', '2']);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[db=1] DB 1 깨짐'), expect.any(String));
  });

  it('앞 틱이 도는 중이면 다음 틱은 건너뛴다', async () => {
    const { publisher, dbService } = makePublisher([undefined]);
    let finish!: (value: number) => void;
    jest.spyOn(publisher, 'publishBatch').mockReturnValueOnce(new Promise<number>((resolve) => (finish = resolve)));

    const first = publisher.tick();
    await publisher.tick();
    finish(0);
    await first;

    expect(dbService.forEachDatabase).toHaveBeenCalledTimes(1);
  });
});
