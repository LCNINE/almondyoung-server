import {
  applyMetaOnCreate,
  applyMetaOnDelete,
  applyMetaOnUpdate,
  restoreMetaSnapshots,
  type PromotionMetaWriter,
} from '../apply-promotion-meta';

/** 호출을 기록하는 최소 writer. 실제 모듈 서비스의 계약만 흉내낸다. */
function fakeWriter(seed: Record<string, Record<string, unknown>> = {}) {
  const rows: Record<string, Record<string, unknown>> = { ...seed };
  const calls: string[] = [];
  const writer: PromotionMetaWriter = {
    async getByPromotionId(id) {
      calls.push(`get:${id}`);
      return rows[id] ?? null;
    },
    async upsert(data) {
      calls.push(`upsert:${data.promotion_id}`);
      rows[data.promotion_id] = { ...(rows[data.promotion_id] ?? {}), ...data };
      return rows[data.promotion_id];
    },
    async deleteByPromotionId(id) {
      calls.push(`delete:${id}`);
      delete rows[id];
    },
    async removeAllIssueLogs(id) {
      calls.push(`logs:${id}`);
    },
  };
  return { writer, rows, calls };
}

describe('applyMetaOnCreate', () => {
  it('additional_data 의 메타 키를 생성된 프로모션마다 쓴다', async () => {
    const { writer, rows } = fakeWriter();
    const written = await applyMetaOnCreate(writer, [{ id: 'promo_1' }], {
      visibility: 'assigned_only',
      name: '가을 쿠폰',
    });
    expect(written).toEqual(['promo_1']);
    expect(rows.promo_1).toMatchObject({
      promotion_id: 'promo_1',
      visibility: 'assigned_only',
      name: '가을 쿠폰',
    });
  });

  it('메타 키가 하나도 없으면 아무것도 쓰지 않는다', async () => {
    const { writer, calls } = fakeWriter();
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], undefined)).toEqual([]);
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], {})).toEqual([]);
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], { unrelated: 1 })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('applyMetaOnUpdate', () => {
  it('이전 상태를 스냅샷으로 돌려주고 부분 갱신한다', async () => {
    const { writer, rows } = fakeWriter({
      promo_1: { promotion_id: 'promo_1', visibility: 'public', name: '옛 이름' },
    });
    const snapshots = await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], { name: '새 이름' });
    expect(snapshots).toEqual([
      {
        promotion_id: 'promo_1',
        before: { promotion_id: 'promo_1', visibility: 'public', name: '옛 이름' },
      },
    ]);
    expect(rows.promo_1).toMatchObject({ visibility: 'public', name: '새 이름' });
  });

  it('메타 키가 없으면 조회조차 하지 않는다 — 상태 토글이 메타를 건드리면 안 된다', async () => {
    const { writer, calls } = fakeWriter({
      promo_1: { promotion_id: 'promo_1', visibility: 'claimable' },
    });
    expect(await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], undefined)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('applyMetaOnDelete', () => {
  it('메타와 발급 로그를 지우고 메타 스냅샷을 돌려준다', async () => {
    const { writer, rows, calls } = fakeWriter({
      promo_1: { promotion_id: 'promo_1', visibility: 'claimable' },
    });
    const snapshots = await applyMetaOnDelete(writer, ['promo_1']);
    expect(snapshots).toEqual([
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1', visibility: 'claimable' } },
    ]);
    expect(rows.promo_1).toBeUndefined();
    expect(calls).toEqual(['get:promo_1', 'delete:promo_1', 'logs:promo_1']);
  });

  it('발급 로그 정리가 실패해도 삭제 전체를 실패시키지 않는다', async () => {
    const { writer } = fakeWriter({ promo_1: { promotion_id: 'promo_1' } });
    writer.removeAllIssueLogs = async () => {
      throw new Error('boom');
    };
    await expect(applyMetaOnDelete(writer, ['promo_1'])).resolves.toEqual([
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1' } },
    ]);
  });
});

describe('restoreMetaSnapshots', () => {
  it('이전에 있었으면 되살리고, 없었으면 지운다', async () => {
    const { writer, rows } = fakeWriter({
      promo_2: { promotion_id: 'promo_2', visibility: 'public' },
    });
    await restoreMetaSnapshots(writer, [
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1', visibility: 'claimable' } },
      { promotion_id: 'promo_2', before: null },
    ]);
    expect(rows.promo_1).toMatchObject({ visibility: 'claimable' });
    expect(rows.promo_2).toBeUndefined();
  });
});
