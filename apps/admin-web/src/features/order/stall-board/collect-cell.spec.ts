import { collectCell, known, MISMATCH_LIST_PATH } from './collect-cell';

const quarantine = {
  quarantined: 3,
  oldestCreatedAt: '2026-10-10T00:00:00.000Z',
};
const mismatch = {
  open: 2,
  human: 1,
  gaveUp: 1,
  oldestFirstSeenAt: '2026-10-09T00:00:00.000Z',
};
const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = { ok: false as const };

describe('collectCell — 정체 보드 0단계 (스펙 §8.1)', () => {
  it('open = 격리 + 열린 불일치, stuck = 격리 + human, gaveUp = 소진, 최장 = 둘 중 이른 쪽', () => {
    const { cell, links } = collectCell(ok(quarantine), ok(mismatch));
    expect(cell).toEqual({
      key: 'collect',
      open: 5,
      stuck: 4,
      gaveUp: 1,
      oldestAt: '2026-10-09T00:00:00.000Z',
    });
    expect(links).toEqual([
      { href: '/mall/channel-listings', label: '수집 격리', count: 3 },
      { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: 2 },
    ]);
  });

  it('어긋남 요약을 못 읽으면 칸은 알 수 없음 — 격리만 세면 적게 세어 정상으로 읽힌다', () => {
    const { cell, links } = collectCell(ok(quarantine), fail);
    expect(cell.open).toBeNull();
    expect(links).toEqual([
      { href: '/mall/channel-listings', label: '수집 격리', count: 3 },
      { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: null },
    ]);
  });

  it('격리 요약을 못 읽어도 칸은 알 수 없음이고 격리 링크는 남는다', () => {
    const { cell, links } = collectCell(fail, ok(mismatch));
    expect(cell.open).toBeNull();
    expect(links.map((l) => [l.label, l.count])).toEqual([
      ['수집 격리', null],
      ['채널과 어긋남', 2],
    ]);
  });

  it('0 인 쪽 링크는 숨긴다', () => {
    const zeroQ = { quarantined: 0, oldestCreatedAt: null };
    const zeroM = { open: 0, human: 0, gaveUp: 0, oldestFirstSeenAt: null };
    expect(
      collectCell(ok(zeroQ), ok(mismatch)).links.map((l) => l.label)
    ).toEqual(['채널과 어긋남']);
    expect(
      collectCell(ok(quarantine), ok(zeroM)).links.map((l) => l.label)
    ).toEqual(['수집 격리']);
    const both = collectCell(ok(zeroQ), ok(zeroM));
    expect(both.links).toEqual([]);
    expect(both.cell).toEqual({
      key: 'collect',
      open: 0,
      stuck: 0,
      gaveUp: 0,
      oldestAt: null,
    });
  });

  it('최장은 한쪽만 있으면 그쪽, 깨진 시각은 무시한다', () => {
    const noOldestM = { ...mismatch, oldestFirstSeenAt: null };
    expect(collectCell(ok(quarantine), ok(noOldestM)).cell.oldestAt).toBe(
      quarantine.oldestCreatedAt
    );
    const badQ = { ...quarantine, oldestCreatedAt: 'not-a-date' };
    expect(collectCell(ok(badQ), ok(mismatch)).cell.oldestAt).toBe(
      mismatch.oldestFirstSeenAt
    );
  });
});

describe('known', () => {
  it('성공이고 값이 있을 때만 ok', () => {
    expect(known({ isSuccess: true, data: 1 })).toEqual({ ok: true, data: 1 });
    expect(known({ isSuccess: false, data: undefined })).toEqual({ ok: false });
    expect(known({ isSuccess: true, data: undefined })).toEqual({ ok: false });
  });
});
