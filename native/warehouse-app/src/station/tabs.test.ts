import { describe, expect, it } from 'vitest';
import { STATION_TABS, activeSectionOf, activeTabOf } from './tabs';

describe('activeTabOf — 가장 긴 접두어가 이긴다', () => {
  it.each([
    ['/outbound', 'F1'],
    ['/outbound/simple/s-1', 'F1'],
    ['/outbound/withdraw/s-1', 'F1'],
    ['/outbound/batches', 'F2'],
    ['/inbound', 'F3'],
    ['/inbound/purchase-orders/po-1', 'F3'],
    ['/inbound/quick', 'F3'],
    ['/inbound/history', 'F3'],
    ['/putaway', 'F4'],
    ['/returns/putaway', 'F4'],
    ['/movement', 'F4'],
    ['/stocktaking/s-1/variances', 'F5'],
    ['/inventory', 'F6'],
    ['/inventory/sku-1/adjust', 'F6'],
  ])('%s → %s', (path, key) => {
    expect(activeTabOf(path)?.key).toBe(key);
  });

  it.each(['/', '/settings', '/diagnostics', '/station/command-sheet', '/outboundx'])('%s 는 어느 탭도 아니다', (path) => {
    expect(activeTabOf(path)).toBeNull();
  });
});

describe('activeSectionOf', () => {
  const f4 = STATION_TABS.find((t) => t.key === 'F4');
  it.each([
    ['/putaway', '적치'],
    ['/returns/putaway', '되돌림 적치'],
    ['/movement', '이동'],
  ])('%s → %s', (path, label) => {
    expect(f4 && activeSectionOf(f4, path)?.label).toBe(label);
  });
});

describe('STATION_TABS', () => {
  it('F1~F6 순서, 각 탭의 첫 경로는 자기 탭에 속한다', () => {
    expect(STATION_TABS.map((t) => t.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    for (const tab of STATION_TABS) expect(activeTabOf(tab.to)?.key).toBe(tab.key);
  });

  it('하위 탭은 F4 에만 — F3 은 입고 화면이 간편입고·입고내역 링크를 이미 갖는다(U2)', () => {
    expect(STATION_TABS.filter((t) => t.sections.length > 0).map((t) => t.key)).toEqual(['F4']);
  });
});
