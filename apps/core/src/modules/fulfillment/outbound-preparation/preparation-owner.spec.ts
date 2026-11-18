import { OUR_HOLDER_KEY, preparationOwnerOf } from './preparation-owner';

describe('preparationOwnerOf', () => {
  it('화주가 없으면 자사', () => {
    expect(preparationOwnerOf([{ ownerId: null, ownerName: null }])).toEqual({ key: OUR_HOLDER_KEY, name: '자사' });
  });

  it('줄이 없어도 자사', () => {
    expect(preparationOwnerOf([]).key).toBe(OUR_HOLDER_KEY);
  });

  it('위탁 화주면 그 화주', () => {
    expect(preparationOwnerOf([{ ownerId: 'h1', ownerName: '업체' }])).toEqual({ key: 'h1', name: '업체' });
  });
});
