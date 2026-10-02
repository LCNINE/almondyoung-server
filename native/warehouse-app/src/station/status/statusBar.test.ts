import { describe, expect, it } from 'vitest';
import type { StoredOperation } from '../../core/operations/operationStore';
import { statusBarItems, unsentCount, type StatusInput } from './statusBar';

const base: StatusInput = {
  printer: { configured: true, lastFailed: false },
  server: 'up',
  unsent: 0,
  batch: null,
  tab: 'F1',
};
const tones = (input: StatusInput) => Object.fromEntries(statusBarItems(input).map((i) => [i.id, i.tone]));
const labels = (input: StatusInput) => statusBarItems(input).map((i) => i.label);

describe('statusBarItems', () => {
  it.each([
    [{ configured: true, lastFailed: false }, 'ok'],
    [{ configured: false, lastFailed: false }, 'bad'],
    [{ configured: true, lastFailed: true }, 'bad'],
  ])('프린터 %o → %s', (printer, tone) => {
    expect(tones({ ...base, printer }).printer).toBe(tone);
  });

  it.each([
    ['up', 'ok'],
    ['down', 'bad'],
    ['unknown', 'idle'],
  ] as const)('서버 %s → %s (모르는 상태를 초록으로 그리지 않는다)', (server, tone) => {
    expect(tones({ ...base, server }).server).toBe(tone);
  });

  it('미전송은 1 이상일 때만 노랑', () => {
    expect(labels(base)).not.toContain('미전송 0');
    expect(statusBarItems({ ...base, unsent: 3 })).toContainEqual({ id: 'unsent', label: '미전송 3', tone: 'warn' });
  });

  it.each([
    ['F1', true],
    ['F2', true],
    ['F3', false],
    [null, false],
  ] as const)('배치 진행은 F1·F2 에서만 (%s → %s)', (tab, shown) => {
    const items = labels({ ...base, tab, batch: { code: 'B-1002', done: 13, total: 40 } });
    expect(items.includes('B-1002 13/40')).toBe(shown);
  });

  it('스캐너 칸은 없다 — HID 리더기는 연결 여부를 알 수 없다', () => {
    expect(statusBarItems(base).map((i) => i.id)).toEqual(['printer', 'server']);
  });
});

describe('unsentCount', () => {
  const op = (status: StoredOperation['status'], createdAt: number): StoredOperation => ({
    id: `${status}-${createdAt}`,
    scope: 's',
    resource: 'r',
    method: 'POST',
    path: '/shipments/x/simple-outbound-scans',
    bodyJson: '{}',
    createdAt,
    status,
    attempts: 1,
  });

  it('보내는 중 1.5초 안은 세지 않고(깜빡임), 넘거나 불확실하면 센다', () => {
    const now = 10_000;
    expect(unsentCount([op('sending', now - 200)], now)).toBe(0);
    expect(unsentCount([op('queued', now - 1500)], now)).toBe(1);
    expect(unsentCount([op('uncertain', now - 10)], now)).toBe(1);
  });
});
