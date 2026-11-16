import { skuNameLikePatterns, MAX_SKU_NAME_TOKENS } from './sku-name-search';

describe('skuNameLikePatterns', () => {
  it('splits on whitespace into one contains-pattern per word', () => {
    expect(skuNameLikePatterns('니트릴 장갑  S')).toEqual(['%니트릴%', '%장갑%', '%S%']);
  });
  it('a single word is the old single pattern — what matched before still matches', () => {
    expect(skuNameLikePatterns('젤브러쉬')).toEqual(['%젤브러쉬%']);
  });
  it('escapes % _ \\ so they match literally', () => {
    expect(skuNameLikePatterns('100% A_1')).toEqual(['%100\\%%', '%A\\_1%']);
  });
  it('blank input gives no patterns', () => {
    expect(skuNameLikePatterns('   ')).toEqual([]);
  });
  it(`keeps at most ${MAX_SKU_NAME_TOKENS} words`, () => {
    expect(skuNameLikePatterns('a b c d e f g h i j')).toHaveLength(MAX_SKU_NAME_TOKENS);
  });
});
