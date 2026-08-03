import { NotFoundError } from '@app/shared';
import { ProductImportSessionReader } from './product-import-session.reader';

/** 체이닝 select 를 흉내내는 최소 mock. 각 테스트가 결과 배열을 주입. */
function makeDb(rows: any[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    then: (resolve: (v: any) => void) => resolve(rows),
  };
  return { run: (fn: any, t?: any) => (t ? fn(t) : fn({ select: () => chain })) } as any;
}

describe('ProductImportSessionReader.getSession', () => {
  it('세션이 없으면 NotFoundError', async () => {
    const optionReadLoader = { getVariantOptionValues: jest.fn() } as any;
    const reader = new ProductImportSessionReader(makeDb([]), optionReadLoader);
    await expect(reader.getSession('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProductImportSessionReader.getVariantComboMap', () => {
  it('옵션 없는 상품은 기본 variant 를 빈 문자열 키로 담는다', async () => {
    const optionReadLoader = { getVariantOptionValues: jest.fn().mockResolvedValue([]) };
    const reader = new ProductImportSessionReader(makeDb([{ variantId: 'v1' }]), optionReadLoader as any);

    const map = await reader.getVariantComboMap('m1', 'ver1');

    expect(map.get('')).toBe('v1');
  });

  it('옵션 조합을 comboKey 규칙으로 정규화해 담는다', async () => {
    const optionReadLoader = {
      getVariantOptionValues: jest.fn().mockResolvedValue([{ id: 'ov1', optionGroupName: '색상', displayName: '빨강' }]),
    };
    const reader = new ProductImportSessionReader(makeDb([{ variantId: 'v1' }]), optionReadLoader as any);

    const map = await reader.getVariantComboMap('m1', 'ver1');

    expect(map.get('색상=빨강')).toBe('v1');
  });
});

describe('ProductImportSessionReader.getProgressCounts', () => {
  it('세션이 없으면 NotFoundError — 집계 쿼리까지 가지 않는다', async () => {
    const optionReadLoader = { getVariantOptionValues: jest.fn() } as any;
    const reader = new ProductImportSessionReader(makeDb([]), optionReadLoader);
    await expect(reader.getProgressCounts('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
