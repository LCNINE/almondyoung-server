import type { DatabaseRun } from '@app/db';
import { LINE_STATE_PUBLISH_BATCH, LineStatePublisher } from './line-state.publisher';

/**
 * 폴러 루프 (#1247). 주문 하나의 DB 동작은 `line-state.publisher.integration.spec.ts`·`line-state-dirty.integration.spec.ts` 가 본다.
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

function batchOf(size: number, startMarkId: number) {
  return Array.from({ length: size }, (_, i) => ({
    salesOrderId: `so-${startMarkId + i}`,
    firstMarkId: startMarkId + i,
  }));
}

describe('LineStatePublisher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('고른 주문이 한도보다 적어질 때까지 다음 배치를 커서 뒤에서 이어 고른다', async () => {
    const { publisher } = makePublisher([undefined]);
    const pick = jest
      .spyOn(publisher, 'pickBatch')
      .mockResolvedValueOnce(batchOf(LINE_STATE_PUBLISH_BATCH, 1))
      .mockResolvedValueOnce(batchOf(3, 1000));
    const publish = jest.spyOn(publisher, 'publishOrder').mockResolvedValue('published');

    await expect(publisher.drainCurrentDatabase(Date.now() + 60_000)).resolves.toBe(LINE_STATE_PUBLISH_BATCH + 3);
    expect(pick.mock.calls).toEqual([[0], [LINE_STATE_PUBLISH_BATCH]]);
    expect(publish).toHaveBeenCalledTimes(LINE_STATE_PUBLISH_BATCH + 3);
  });

  it('표시된 주문이 없으면 한 번 고르고 끝나며 enqueue 는 없다', async () => {
    const { publisher, enqueue } = makePublisher([undefined]);
    const pick = jest.spyOn(publisher, 'pickBatch').mockResolvedValue([]);
    const publish = jest.spyOn(publisher, 'publishOrder');

    await expect(publisher.drainCurrentDatabase(Date.now() + 60_000)).resolves.toBe(0);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('잠긴 주문은 세지 않고, 한 주문의 실패는 다음 주문을 막지 않는다', async () => {
    const { publisher } = makePublisher([undefined]);
    jest.spyOn(publisher, 'pickBatch').mockResolvedValue(batchOf(3, 1));
    jest
      .spyOn(publisher, 'publishOrder')
      .mockResolvedValueOnce('locked')
      .mockRejectedValueOnce(new Error('계약 위반'))
      .mockResolvedValueOnce('published');
    const logged = jest.spyOn(publisher['logger'], 'error').mockImplementation(() => undefined);

    await expect(publisher.drainCurrentDatabase(Date.now() + 60_000)).resolves.toBe(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('salesOrderId=so-2'), expect.any(String));
  });

  it('시간 한도가 지나면 배치가 가득 차도 멈춘다 — 그래도 한 배치는 돈다', async () => {
    const { publisher } = makePublisher([undefined]);
    const pick = jest.spyOn(publisher, 'pickBatch').mockResolvedValue(batchOf(LINE_STATE_PUBLISH_BATCH, 1));
    jest.spyOn(publisher, 'publishOrder').mockResolvedValue('published');

    await expect(publisher.drainCurrentDatabase(Date.now() - 1)).resolves.toBe(LINE_STATE_PUBLISH_BATCH);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('tick 은 DB 마다 돌고, 한 DB 의 실패가 다른 DB 를 막지 않는다', async () => {
    const { publisher, visited } = makePublisher(['1', '2']);
    jest.spyOn(publisher, 'pickBatch').mockRejectedValueOnce(new Error('DB 1 깨짐')).mockResolvedValueOnce([]);
    const logged = jest.spyOn(publisher['logger'], 'error').mockImplementation(() => undefined);

    await publisher.tick();

    expect(visited).toEqual(['1', '2']);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[db=1] DB 1 깨짐'), expect.any(String));
  });

  it('앞 틱이 도는 중이면 다음 틱은 건너뛴다', async () => {
    const { publisher, dbService } = makePublisher([undefined]);
    let finish!: (value: []) => void;
    jest.spyOn(publisher, 'pickBatch').mockReturnValueOnce(new Promise<[]>((resolve) => (finish = resolve)));

    const first = publisher.tick();
    await publisher.tick();
    finish([]);
    await first;

    expect(dbService.forEachDatabase).toHaveBeenCalledTimes(1);
  });
});
