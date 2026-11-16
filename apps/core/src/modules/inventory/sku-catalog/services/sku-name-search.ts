import { likeContains } from '../../sku-field-capture/sku-field-capture.rules';

export const MAX_SKU_NAME_TOKENS = 8;

/** 공백으로 나눈 단어마다 «포함» 패턴 하나. 빈 입력은 패턴 없음. */
export function skuNameLikePatterns(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SKU_NAME_TOKENS).map(likeContains);
}
