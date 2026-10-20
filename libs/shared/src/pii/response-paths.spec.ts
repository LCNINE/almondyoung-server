import { countRawValues, maskPaths, parsePiiPath, readPathValues } from './response-paths';

describe('parsePiiPath', () => {
  it('parses keys, nested arrays and a root array', () => {
    expect(parsePiiPath('data[].shippingAddress.phone')).toEqual([
      { key: 'data', each: true },
      { key: 'shippingAddress', each: false },
      { key: 'phone', each: false },
    ]);
    expect(parsePiiPath('[].customerName')).toEqual([
      { key: null, each: true },
      { key: 'customerName', each: false },
    ]);
  });

  it('parses a wildcard that walks every value of an object', () => {
    expect(parsePiiPath('*[].customerInfo.phone')).toEqual([
      { key: '*', each: true },
      { key: 'customerInfo', each: false },
      { key: 'phone', each: false },
    ]);
  });

  it('rejects malformed paths', () => {
    for (const bad of ['', 'a..b', '[]', 'a[]b', '.a', 'a.', 'a[x]', 'a b']) {
      expect(() => parsePiiPath(bad)).toThrow();
    }
  });
});

describe('readPathValues', () => {
  it('reads values through arrays and skips missing branches', () => {
    const body = { data: [{ id: 'a' }, { id: 'b' }, { other: 1 }] };
    expect(readPathValues(body, 'data[].id')).toEqual(['a', 'b']);
    expect(readPathValues([{ id: 'x' }], '[].id')).toEqual(['x']);
    expect(readPathValues(null, 'data[].id')).toEqual([]);
  });
});

describe('maskPaths', () => {
  const body = {
    data: [
      { customerName: '홍길동', shippingAddress: { phone: '010-1234-5678', memo: '문 앞' } },
      { customerName: '김철수', shippingAddress: null },
    ],
    total: 2,
  };

  it('masks nested array paths without touching the input', () => {
    const snapshot = JSON.stringify(body);
    const result = maskPaths(body, {
      'data[].customerName': 'name',
      'data[].shippingAddress.phone': 'phone',
    });
    expect(result.body).toEqual({
      data: [
        { customerName: '홍*동', shippingAddress: { phone: '010-****-5678', memo: '문 앞' } },
        { customerName: '김*수', shippingAddress: null },
      ],
      total: 2,
    });
    expect(JSON.stringify(body)).toBe(snapshot);
    expect(result.maskedKinds.sort()).toEqual(['name', 'phone']);
    expect(result.redactedPaths).toEqual([]);
    expect(result.maskedValueCount).toBe(3);
  });

  it('redacts a whole subtree declared as redact', () => {
    const result = maskPaths({ deltas: [{ before: { a: 1 } }] }, { 'deltas[].before': 'redact' });
    expect(result.body).toEqual({ deltas: [{ before: null }] });
    expect(result.redactedPaths).toEqual(['deltas[].before']);
    expect(result.maskedKinds).toEqual(['redact']);
  });

  it('leaves null and empty values as they are', () => {
    const result = maskPaths({ a: null, b: '', c: undefined }, { a: 'name', b: 'name', c: 'name' });
    expect(result.body).toEqual({ a: null, b: '', c: undefined });
    expect(result.maskedKinds).toEqual([]);
    expect(result.maskedValueCount).toBe(0);
  });

  it('treats a non-string under a string kind as redact', () => {
    const result = maskPaths({ phone: 1012345678, address: { road: 'x' } }, { phone: 'phone', address: 'address' });
    expect(result.body).toEqual({ phone: null, address: null });
    expect(result.redactedPaths.sort()).toEqual(['address', 'phone']);
  });

  it('masks every element of a root array', () => {
    const result = maskPaths([{ n: '홍길동' }, { n: '김철수' }], { '[].n': 'name' });
    expect(result.body).toEqual([{ n: '홍*동' }, { n: '김*수' }]);
  });
});

describe('wildcard keys', () => {
  it('masks every value of an object keyed by name', () => {
    const body = { 업체A: [{ n: '홍길동' }], 업체B: [{ n: '김철수' }, { n: null }] };
    const result = maskPaths(body, { '*[].n': 'name' });
    expect(result.body).toEqual({ 업체A: [{ n: '홍*동' }], 업체B: [{ n: '김*수' }, { n: null }] });
    expect(readPathValues(body, '*[].n')).toEqual(['홍길동', '김철수', null]);
    expect(countRawValues(body, { '*[].n': 'name' })).toBe(2);
  });
});

describe('countRawValues', () => {
  it('counts raw values only where a value exists', () => {
    const body = { data: [{ n: '홍길동', p: '' }, { n: null, p: '010' }, {}] };
    expect(countRawValues(body, { 'data[].n': 'name', 'data[].p': 'phone' })).toBe(2);
  });

  it('counts a non-empty object under redact', () => {
    expect(countRawValues({ m: { a: 1 }, e: {} }, { m: 'redact', e: 'redact' })).toBe(2);
  });
});
