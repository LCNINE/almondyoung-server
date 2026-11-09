import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogGrantsFor, channelInventoryIsManual, isPlaceholderEnv, missingGrants, orderSourceWired } from './rules';

const repo = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

describe('cutover preflight rules', () => {
  it('logistics_worker 의 기대 권한에 현장 출고 권한이 들어 있다', () => {
    expect(catalogGrantsFor('logistics_worker')).toEqual(
      expect.arrayContaining(['fulfillment.warehouse.operate', 'fulfillment.shipment.read', 'inventory.stock.operate']),
    );
  });

  it('missingGrants 는 기대 중 없는 것만 돌려준다', () => {
    expect(missingGrants(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(missingGrants(['a'], ['a', 'z'])).toEqual([]);
  });

  it('자리표시 env 값을 알아본다', () => {
    expect(isPlaceholderEnv(`  NAVER_CLIENT_ID: '1',`, 'NAVER_CLIENT_ID')).toBe(true);
    expect(isPlaceholderEnv(`  NAVER_API_ENDPOINT: 'https://dummy.com',`, 'NAVER_API_ENDPOINT')).toBe(true);
    expect(isPlaceholderEnv(`  NAVER_CLIENT_ID: naverClientId.value,`, 'NAVER_CLIENT_ID')).toBe(false);
  });

  it('채널 블록 단위로 inventory manual 여부를 본다', () => {
    const text = [
      'export const X = {',
      '  medusa: {',
      "    inventory: { kind: 'projection' },",
      '  },',
      '  naver: {',
      "    inventory: { kind: 'manual', reason: 'x' },",
      '  },',
      "  '3pl': {",
      "    integration: 'none',",
      '  },',
      '};',
    ].join('\n');
    expect(channelInventoryIsManual(text, 'medusa')).toBe(false);
    expect(channelInventoryIsManual(text, 'naver')).toBe(true);
    expect(channelInventoryIsManual(text, 'coupang')).toBe(false);
  });

  // 실제 파일 모양에 대한 가드 — 파일이 바뀌어 판정이 조용히 틀어지는 것을 막는다.
  it('실제 channel-capabilities.ts 에서 medusa 는 manual 이 아니다', () => {
    const text = read('apps/channel-adapter/src/services/channel-capabilities.ts');
    expect(text).toContain('\n  medusa: {');
    expect(channelInventoryIsManual(text, 'medusa')).toBe(false);
  });

  it('실제 adapter.module.ts 에서 Medusa 수집 source 를 찾는다', () => {
    const text = read('apps/channel-adapter/src/adapter.module.ts');
    expect(orderSourceWired(text, 'MedusaOrderSource')).toBe(true);
    expect(orderSourceWired(text, 'NoSuchOrderSource')).toBe(false);
  });
});
