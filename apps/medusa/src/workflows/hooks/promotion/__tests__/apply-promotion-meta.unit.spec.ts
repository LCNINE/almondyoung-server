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

  // W3: 추출기(extractMetaFromAdditionalData)는 create·update 두 경로가 공유한다 — 생성 경로도
  // 명시적 null 을 그대로 흘려보낸다(생성 시점엔 실무적 의미가 크진 않지만, 갈라지면 안 된다).
  it('명시적 null 도 그대로 쓴다 — update 와 같은 추출기를 공유한다', async () => {
    const { writer, rows } = fakeWriter();
    await applyMetaOnCreate(writer, [{ id: 'promo_1' }], {
      visibility: 'claimable',
      ends_at: null,
    });
    expect(rows.promo_1).toMatchObject({ visibility: 'claimable', ends_at: null });
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

  // W3 (2026-08-31): {status} 만 보내는 상태 토글(additional_data 자체가 없다)과, 관리자가
  // 명시적으로 `{ ends_at: null }` 을 보내 비우는 것을 구분해야 한다. 전자는 위 테스트가,
  // 후자는 이 테스트가 지킨다 — 둘 다 지켜야 P10-A 의 구멍이 다시 안 열린다.
  // (실제 `key in additional_data` 판정은 `helpers.ts` 의 `extractMetaFromAdditionalData` 안에
  // 있다 — 여기서는 그 산출물이 upsert 까지 그대로 전해지는지를 확인한다.)
  it('명시적 null 은 그 필드만 비운다 — 다른 메타는 그대로 남는다', async () => {
    const { writer, rows } = fakeWriter({
      promo_1: {
        promotion_id: 'promo_1',
        visibility: 'claimable',
        starts_at: '2026-09-01T00:00:00.000Z',
        ends_at: '2026-09-30T00:00:00.000Z',
        validity_days: 30,
      },
    });
    await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], { ends_at: null, validity_days: null });
    expect(rows.promo_1).toMatchObject({
      visibility: 'claimable',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      validity_days: null,
    });
  });

  it('키가 없는 필드는 null 로 덮이지 않는다 — 부분 갱신이 여전히 부분이다', async () => {
    const { writer, rows } = fakeWriter({
      promo_1: {
        promotion_id: 'promo_1',
        visibility: 'claimable',
        ends_at: '2026-09-30T00:00:00.000Z',
      },
    });
    await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], { name: '새 이름' });
    expect(rows.promo_1).toMatchObject({
      visibility: 'claimable',
      ends_at: '2026-09-30T00:00:00.000Z',
      name: '새 이름',
    });
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
