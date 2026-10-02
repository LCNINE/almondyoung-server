import { sql as sqlQuery } from 'drizzle-orm';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { makeDb } from './logistics-wiring';

/**
 * 커밋형 동시성 스펙의 겹침 — 두 연결에서 `first` 를 먼저 돌려 잠금을 쥔 채 멈추고, `second` 가 그 연결에
 * **막혔는지**(`pg_blocking_pids`)까지 단언한 뒤 `first` 를 커밋시킨다. 둘째의 결과는 성공·실패를 값으로 돌려준다.
 * 막힘 단언이 핵심이다 — 막히지 않고 끝났다면 두 트랜잭션이 같은 잠금에서 줄을 서지 않았다는 뜻이다.
 */
export async function overlap<T, U>(
  observer: ReturnType<typeof makeDb>,
  first: (tx: DbTx) => Promise<T>,
  second: (tx: DbTx) => Promise<U>,
) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('overlap needs DATABASE_URL — call it only inside a describeIfDb suite');
  const a = makeDb(url);
  const b = makeDb(url);
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const atBarrier = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let runA: Promise<T> | undefined;
  let runB: Promise<U> | undefined;
  try {
    const [{ pid: pidA }] = await a.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
    const [{ pid: pidB }] = await b.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
    expect(pidA).not.toBe(pidB);
    runA = a.db.transaction(async (tx) => {
      await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
      const value = await first(tx);
      entered();
      await barrier;
      return value;
    });
    // Attach rejection handlers immediately, so failed transactions cannot leak unhandled rejections.
    const resultA = runA.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await Promise.race([
      atBarrier,
      resultA.then((result) => {
        throw result.ok ? new Error('missed barrier') : result.error;
      }),
    ]);
    let completed = false;
    runB = b.db.transaction(async (tx) => {
      await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
      return second(tx);
    });
    const resultB = runB
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => {
        completed = true;
      });
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (!completed && Date.now() < deadline) {
      const [{ waiting }] = await observer.sql<
        { waiting: boolean }[]
      >`select ${pidA}::int = any(pg_blocking_pids(${pidB}::int)) as waiting`;
      if (waiting) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    expect(completed).toBe(false);
    release();
    const firstResult = await resultA;
    if (!firstResult.ok) throw firstResult.error;
    return { first: firstResult.value, second: await resultB };
  } finally {
    release();
    await Promise.allSettled([runA, runB].filter((value) => value !== undefined));
    await Promise.all([a.sql.end(), b.sql.end()]);
  }
}
