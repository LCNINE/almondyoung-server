import { customerReturnQueryKeys as keys } from './query-keys';

describe('customerReturnQueryKeys', () => {
  it('빈 값 칸은 키에서 빠져 같은 목록은 같은 키다', () => {
    expect(keys.list({ bucket: 'open', q: '' })).toEqual(keys.list({ bucket: 'open' }));
    expect(keys.list({ bucket: 'open', q: '  ' })).toEqual(keys.list({ bucket: 'open' }));
    expect(keys.list({ bucket: 'open', q: 'abc' })).not.toEqual(keys.list({ bucket: 'open' }));
  });

  it('어떤 키에도 undefined 원소가 없다 (TanStack 무효화가 조용히 안 걸린다)', () => {
    const all = [
      keys.all,
      keys.list({ bucket: 'closed', q: undefined, limit: undefined, offset: undefined }),
      keys.list({ bucket: 'attention', q: 'x', limit: 10, offset: 0 }),
      keys.detail('r1'),
      keys.preview('o1', 'r1'),
      keys.returnable('o1'),
    ];
    for (const key of all) {
      expect(JSON.stringify(key)).not.toContain('null');
      expect(key.every((part) => part !== undefined)).toBe(true);
      const q = key.find((part) => typeof part === 'object' && part !== null);
      if (q) expect(Object.values(q).every((v) => v !== undefined)).toBe(true);
    }
  });

  it('전부 all 로 시작한다', () => {
    const rest = [keys.list({ bucket: 'open' }), keys.detail('r1'), keys.preview('o1', 'r1'), keys.returnable('o1')];
    for (const key of rest) expect(key[0]).toBe(keys.all[0]);
  });
});
