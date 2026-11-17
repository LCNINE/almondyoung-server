import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catalogGrantsFor,
  channelInventoryIsManual,
  isPlaceholderEnv,
  isPlaceholderValue,
  judgeReconcile,
  type ReconcileFacts,
  linkedSecretValue,
  missingGrants,
  orderSourceWired,
  overdueShipmentFix,
  reservationAxisFindings,
  reservationMismatches,
  shelfCodeLinks,
} from './rules';
import { reservationTarget } from '../../../apps/channel-adapter/src/services/reservation-projection/reservation-target';

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

  it('자리표시 값 판정', () => {
    for (const v of [undefined, '', '1', 'https://dummy.com']) expect(isPlaceholderValue(v)).toBe(true);
    expect(isPlaceholderValue('abc-real-looking')).toBe(false);
  });

  it('linkedSecretValue 는 SST_RESOURCE_<name> 의 value 를 읽고 없으면 null', () => {
    expect(linkedSecretValue('X', {})).toBeNull();
    expect(linkedSecretValue('X', { SST_RESOURCE_X: '{"value":"1"}' })).toBe('1');
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

  it('선반 텍스트를 고쳐 읽은 코드로 로케이션과 잇고, 예외는 따로 센다 (#1235)', () => {
    expect(shelfCodeLinks(['CC-4-1', 'A-01-01', 'A-01-02', '외부창고'], ['CC-04-01', 'A-01-01'])).toEqual({
      linked: 2,
      unlinked: ['A-01-02'],
      exceptions: ['외부창고'],
    });
  });
});

describe('Medusa 예약 투영 축 (#1247)', () => {
  const now = new Date('2026-11-21T00:00:00Z');
  const base = {
    phase: 'after' as const,
    cutoverAt: new Date('2026-11-20T00:00:00Z'),
    openHalted: 0,
    lastFinishedAt: new Date('2026-11-20T18:00:00Z'),
    lastRunning: false,
    now,
    mismatches: 0,
  };
  const bads = (i: Parameters<typeof reservationAxisFindings>[0]) =>
    reservationAxisFindings(i).filter((f) => f.level === 'bad');

  it('정상이면 ✗ 가 없다', () => expect(bads(base)).toEqual([]));
  it('--after-cutover 인데 T 없음 → ✗', () => {
    const [f] = bads({ ...base, cutoverAt: null });
    expect(f.fix).toContain('set-reservation-cutover');
  });
  it('컷오버 전 T 없음은 실패가 아니다', () => expect(bads({ ...base, phase: 'before', cutoverAt: null })).toEqual([]));
  it('열린 halted 회차 → ✗', () => {
    const [f] = bads({ ...base, openHalted: 1 });
    expect(f.fix).toContain('/order/channel-mismatches');
  });
  it('마지막 회차가 26시간보다 오래 → ✗, 26시간 이내는 통과', () => {
    expect(bads({ ...base, lastFinishedAt: new Date('2026-11-19T21:00:00Z') })).toHaveLength(1);
    expect(bads({ ...base, lastFinishedAt: new Date('2026-11-19T23:00:00Z') })).toHaveLength(0);
  });
  it('회차가 없으면 ✗, 도는 중이면 아니다', () => {
    expect(bads({ ...base, lastFinishedAt: null })).toHaveLength(1);
    expect(bads({ ...base, lastFinishedAt: null, lastRunning: true })).toHaveLength(0);
  });
  it('재계산 어긋남 ≠ 0 → ✗, 고치는 길은 화면에 있는 것만 적는다', () => {
    const found = bads({ ...base, mismatches: 2 });
    expect(found).toHaveLength(1);
    expect(found[0].fix).toContain('확인했으니 고치기');
    expect(found[0].fix).not.toContain('강제 재실행');
  });
  it('오래된 회차의 고치는 길은 화면에 없는 버튼을 가리키지 않는다', () => {
    const [f] = bads({ ...base, lastFinishedAt: new Date('2026-11-19T21:00:00Z') });
    expect(f.fix).not.toMatch(/에서 강제 재실행/);
  });

  it('reservationMismatches 는 주입한 reservationTarget 으로 센다', () => {
    const lines = [
      { lineItemId: 'a', ordered: 3, canceledBeforeShipment: 1, current: 2 }, // 목표 2 — 일치
      { lineItemId: 'b', ordered: 3, canceledBeforeShipment: 0, current: 1 }, // 목표 3 — 어긋남
      { lineItemId: 'c', ordered: 2, canceledBeforeShipment: 2, current: 1 }, // 목표 0 — 어긋남
    ];
    expect(reservationMismatches(lines, reservationTarget).map((l) => l.lineItemId)).toEqual(['b', 'c']);
  });

  it('예정일 지난 선적 안내는 컷오버 전/후가 다르다', () => {
    expect(overdueShipmentFix('before')).toContain('셀메이트로 받음');
    expect(overdueShipmentFix('after')).toBe('예정일을 고치거나 닫는다');
  });
});

describe('judgeReconcile', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const T = new Date('2026-11-20T00:00:00Z');
  const base: ReconcileFacts = {
    tablesExist: true,
    initCutoverAt: T,
    adapterCutoverAt: T,
    openRunCreatedAt: null,
    pairRows: 10,
    unpaired: [],
    carry: [],
  };
  const judge = (over: Partial<ReconcileFacts>) => judgeReconcile({ ...base, ...over }, now);

  it('테이블이 없으면 bad + 마이그레이션 명령', () => {
    const v = judge({ tablesExist: false });
    expect(v).toHaveLength(1);
    expect(v[0].level).toBe('bad');
    expect(v[0].fix).toContain('npm run db:migrate -- --stage live --deployment lcnine-services --yes');
  });

  it('전부 정상이면 bad·dayOf 가 없다', () => {
    const v = judge({});
    expect(v.filter((x) => x.level === 'bad' || x.level === 'dayOf')).toEqual([]);
    expect(v.some((x) => x.level === 'ok')).toBe(true);
  });

  it('init 이 없으면 dayOf + init 명령', () => {
    const v = judge({ initCutoverAt: null });
    const d = v.filter((x) => x.level === 'dayOf');
    expect(d).toHaveLength(1);
    expect(d[0].fix).toContain(
      'WITH_MEDUSA=1 bash scripts/sellmate/run.sh live evening-reconcile init <재고 CSV> --cutover-at=<T> --sellmate-orders=<주문 목록> --own-mall-channel=<판매처> --apply',
    );
  });

  it('init T 와 adapter T 가 다르면 bad, 같은 시각이면 통과', () => {
    expect(judge({ adapterCutoverAt: new Date('2026-11-20T01:00:00Z') }).filter((x) => x.level === 'bad')).toHaveLength(
      1,
    );
    expect(judge({ adapterCutoverAt: null }).filter((x) => x.level === 'bad')).toHaveLength(1);
    expect(judge({ adapterCutoverAt: new Date(T.getTime()) }).filter((x) => x.level === 'bad')).toHaveLength(0);
  });

  it('adapter T 를 못 읽으면 info', () => {
    const v = judge({ adapterCutoverAt: undefined });
    expect(v.filter((x) => x.level === 'bad')).toHaveLength(0);
    expect(v.some((x) => x.level === 'info' && x.msg.includes('channel_adapter'))).toBe(true);
  });

  it('열린 회차가 25시간이면 bad + close 명령, 2시간이면 info', () => {
    const old = judge({ openRunCreatedAt: new Date(now.getTime() - 25 * 3600_000) }).filter((x) => x.level === 'bad');
    expect(old).toHaveLength(1);
    expect(old[0].fix).toContain('evening-reconcile close <새 재고 CSV> --apply');
    const fresh = judge({ openRunCreatedAt: new Date(now.getTime() - 2 * 3600_000) });
    expect(fresh.filter((x) => x.level === 'bad')).toHaveLength(0);
    expect(fresh.some((x) => x.level === 'info' && x.msg.includes('열린'))).toBe(true);
  });

  it('짝 행이 0 이면 bad + pair 명령', () => {
    const b = judge({ pairRows: 0 }).filter((x) => x.level === 'bad');
    expect(b).toHaveLength(1);
    expect(b[0].fix).toContain('evening-reconcile pair <재고 CSV> --apply');
  });

  it('짝 못 지은 품목은 bad 하나로 건수와 사유별 수를 적는다', () => {
    const b = judge({
      unpaired: [
        { optionSerial: 'TEST-0001', reason: 'no_barcode' },
        { optionSerial: 'TEST-0002', reason: 'no_barcode' },
        { optionSerial: 'TEST-0003', reason: 'ambiguous' },
      ],
    }).filter((x) => x.level === 'bad');
    expect(b).toHaveLength(1);
    expect(b[0].msg).toContain('3');
    expect(b[0].msg).toContain('no_barcode 2');
    expect(b[0].msg).toContain('ambiguous 1');
  });

  it('이월은 info 이고 실패가 아니다', () => {
    const v = judge({ carry: [{ optionSerial: 'TEST-0001', skuCode: 'SKU-1', carry: 3 }] });
    expect(v.filter((x) => x.level === 'bad')).toHaveLength(0);
    expect(v.some((x) => x.level === 'info' && x.msg.includes('이월'))).toBe(true);
  });
});
