import { isSameCategorySet } from './almond-template-category.manager';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('isSameCategorySet', () => {
  it('순서만 다르고 구성이 같으면 받아들인다', () => {
    expect(isSameCategorySet([B, A], [A, B])).toBe(true);
  });

  it.each<[string, string[], string[]]>([
    ['하나가 빠졌다', [A], [A, B]],
    ['그 사이 하나가 추가됐다', [A, B], [A, B, C]],
    ['없는 id 가 섞였다', [A, C], [A, B]],
    ['같은 id 를 두 번 보냈다', [A, A], [A, B]],
  ])('%s 면 거부한다', (_, ids, current) => {
    expect(isSameCategorySet(ids, current)).toBe(false);
  });
});
