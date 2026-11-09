import { ReservationCutoverRepository } from './reservation-cutover.repository';

/** 한 행짜리 테이블을 흉내 내는 가짜 DbService. 쿼리 빌더 체인 모양만 맞춘다. */
function fakeDb() {
  let row: { cutoverAt: Date | null; updatedBy: string | null } | undefined;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    insert: () => ({
      values: (v: { cutoverAt: Date | null; updatedBy: string }) => ({
        onConflictDoUpdate: async ({ set }: { set: { cutoverAt: Date | null; updatedBy: string } }) => {
          row = row
            ? { cutoverAt: set.cutoverAt, updatedBy: set.updatedBy }
            : { cutoverAt: v.cutoverAt, updatedBy: v.updatedBy };
        },
      }),
    }),
  };
  return { db };
}

describe('ReservationCutoverRepository', () => {
  it('행이 없으면 null', async () => {
    const repo = new ReservationCutoverRepository(fakeDb() as never);
    await expect(repo.get()).resolves.toBeNull();
  });

  it('set 을 두 번 하면 마지막 값, clear 는 null', async () => {
    const repo = new ReservationCutoverRepository(fakeDb() as never);
    await repo.set(new Date('2026-11-10T00:00:00Z'), 'a');
    await repo.set(new Date('2026-11-11T00:00:00Z'), 'b');
    await expect(repo.get()).resolves.toEqual(new Date('2026-11-11T00:00:00Z'));
    await repo.set(null, 'c');
    await expect(repo.get()).resolves.toBeNull();
  });
});
