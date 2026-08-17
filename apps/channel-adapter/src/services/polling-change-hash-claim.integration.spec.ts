// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { PollingChangeHashService } from './polling-change-hash.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const SOURCE = 'medusa';
const RESOURCE_TYPE = 'order_lifecycle';

/**
 * `claimChanged` 의 유닛 테스트는 목이 CAS 를 흉내낸다 — 그 목이 **실제 Postgres 와 같은지**는
 * 여기서만 증명된다 (#599). 특히 두 가지가 여기서 검증된다:
 *
 * 1. drizzle 의 `setWhere` 가 `ON CONFLICT DO UPDATE … WHERE` 로 제대로 렌더링되는가
 * 2. 겹친 두 트랜잭션에서 **정확히 한 쪽만** 선점하는가 (행 잠금 뒤 술어 재평가)
 */
describeIfDb('PollingChangeHashService.claimChanged (PostgreSQL integration)', () => {
  // `describe.skip` 도 콜백 본문은 실행된다 — 연결 객체를 여기서 만들면 DB 없는 기본 실행에서도
  // 쓸모없이 생성된다. `beforeAll` 은 skip 시 아예 돌지 않으므로 그쪽에서 만든다.
  let client: ReturnType<typeof postgres>;
  let service: PollingChangeHashService;
  let db: ReturnType<typeof drizzle>;
  const created: string[] = [];

  const newResourceId = () => {
    const id = `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    created.push(id);
    return id;
  };

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4, prepare: false });
    db = drizzle(client);
    service = new PollingChangeHashService({ db } as never);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await client`delete from polling_change_hashes where resource_id = any(${client.array(created)})`;
    }
    await client.end({ timeout: 5 });
  });

  it('claims a resource it has never seen', async () => {
    const resourceId = newResourceId();

    await expect(service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1')).resolves.toBe(true);
  });

  it('refuses to re-claim an unchanged hash', async () => {
    const resourceId = newResourceId();

    await service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1');

    await expect(service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1')).resolves.toBe(false);
  });

  it('claims again once the hash actually changes', async () => {
    const resourceId = newResourceId();

    await service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1');

    await expect(service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-2')).resolves.toBe(true);
    await expect(service.getStoredHash(SOURCE, RESOURCE_TYPE, resourceId)).resolves.toBe('hash-2');
  });

  // 이것이 #599 의 본체다 — 겹쳐 도는 두 폴이 같은 사실을 두 번 발행하던 레이스.
  it('lets exactly one of two concurrent transactions claim the same changed hash', async () => {
    const resourceId = newResourceId();

    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstClaimed!: (won: boolean) => void;
    const firstDidClaim = new Promise<boolean>((resolve) => {
      firstClaimed = resolve;
    });

    try {
      const txA = db.transaction(async (tx) => {
        const won = await service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1', tx as never);
        firstClaimed(won);
        await firstMayCommit;
        return won;
      });

      // A 가 선점한 뒤 아직 커밋하지 않은 상태에서 B 를 띄운다 — 프로덕션의 겹친 폴과 같은 모양.
      await expect(firstDidClaim).resolves.toBe(true);

      let secondSettled = false;
      const txB = db
        .transaction(async (tx) => service.claimChanged(SOURCE, RESOURCE_TYPE, resourceId, 'hash-1', tx as never))
        .then((won) => {
          secondSettled = true;
          return won;
        });

      // B 는 A 가 잡은 행 잠금에서 대기해야 한다.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(secondSettled).toBe(false);

      releaseFirst();

      await expect(txA).resolves.toBe(true);
      await expect(txB).resolves.toBe(false);
    } finally {
      releaseFirst();
    }
  });
});
