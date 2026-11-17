import { judgeShelfMove, ShelfMoveInput, ShelfMoveVerdict } from './shelf-move-verdict';

const base: ShelfMoveInput = {
  position: { code: 'A-01-01', updatedAt: new Date('2026-11-20T10:00:00Z') },
  freshSince: new Date('2026-11-20T09:00:00Z'),
  locationCodes: new Set(['A-01-01', 'CC-04-01', 'O-21-30', 'M-07-꼭대기']),
  shelvesWithStock: [],
  includeRules: new Set(),
};
const at = (code: string) => ({ code, updatedAt: base.position!.updatedAt });

describe('judgeShelfMove — 위치를 하나로 아는 SKU 만 옮긴다 (#1236)', () => {
  it.each<[string, Partial<ShelfMoveInput>, ShelfMoveVerdict]>([
    ['글자까지 같은 코드 → 옮긴다', {}, { kind: 'move', toCode: 'A-01-01', rule: 'exact' }],
    ['위치 행이 없다', { position: null }, { kind: 'keep', reason: 'no-position' }],
    [
      'T 당일 적재가 다시 쓰지 않은 행',
      { position: { code: 'A-01-01', updatedAt: new Date('2026-11-19T00:00:00Z') } },
      { kind: 'keep', reason: 'stale' },
    ],
    [
      '판정 스크립트(freshSince 없음)는 신선도를 보지 않는다',
      { position: { code: 'A-01-01', updatedAt: new Date('2026-11-19T00:00:00Z') }, freshSince: null },
      { kind: 'move', toCode: 'A-01-01', rule: 'exact' },
    ],
    ['창고 이름 같은 텍스트', { position: at('외부창고') }, { kind: 'keep', reason: 'unreadable' }],
    ['한 칸에 위치 여럿', { position: at('A-01-01,B-02-03') }, { kind: 'keep', reason: 'unreadable' }],
    ['0 채우기 규칙이 꺼져 있다', { position: at('CC-4-1') }, { kind: 'keep', reason: 'unconfirmed' }],
    [
      '0 채우기 규칙을 켰다',
      { position: at('CC-4-1'), includeRules: new Set(['zero-pad'] as const) },
      { kind: 'move', toCode: 'CC-04-01', rule: 'zero-pad' },
    ],
    [
      '대시 자리 규칙을 켰다',
      { position: at('O21-30-'), includeRules: new Set(['dash-position'] as const) },
      { kind: 'move', toCode: 'O-21-30', rule: 'dash-position' },
    ],
    [
      '다른 규칙만 켜져 있으면 대시 자리는 여전히 미확인',
      { position: at('O21-30-'), includeRules: new Set(['zero-pad'] as const) },
      { kind: 'keep', reason: 'unconfirmed' },
    ],
    [
      '커스텀 칸 규칙을 켰다',
      { position: at('M-07-꼭대기'), includeRules: new Set(['custom-bin'] as const) },
      { kind: 'move', toCode: 'M-07-꼭대기', rule: 'custom-bin' },
    ],
    ['읽혔지만 그 로케이션이 창고에 없다', { position: at('B-09-09') }, { kind: 'keep', reason: 'no-location' }],
    ['다른 선반에 이미 재고', { shelvesWithStock: ['B-01-01'] }, { kind: 'keep', reason: 'elsewhere' }],
    [
      '같은 선반에 이미 재고면 나뉘지 않는다',
      { shelvesWithStock: ['A-01-01'] },
      { kind: 'move', toCode: 'A-01-01', rule: 'exact' },
    ],
    [
      '앞선 사유가 이긴다 — 낡았으면서 못 읽는 행은 stale',
      { position: { code: '외부창고', updatedAt: new Date('2026-11-19T00:00:00Z') } },
      { kind: 'keep', reason: 'stale' },
    ],
  ])('%s', (_name, override, expected) => {
    expect(judgeShelfMove({ ...base, ...override })).toEqual(expected);
  });
});
