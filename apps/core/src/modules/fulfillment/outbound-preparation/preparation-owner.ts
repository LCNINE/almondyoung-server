import { OptionLine } from '../services/consolidation-shipment-reads';

// 화주 필터의 자사 값. 위탁 업체는 화주 id 로 고른다
export const OUR_HOLDER_KEY = 'own';
export const OUR_HOLDER_NAME = '자사';

export interface PreparationOwner {
  key: string;
  name: string;
}

/** 상자의 화주. 상자 하나는 출고주문 하나에서 나오고, 합친 상자는 자사끼리만 묶이므로 줄 하나로 정해진다 */
export function preparationOwnerOf(lines: readonly Pick<OptionLine, 'ownerId' | 'ownerName'>[]): PreparationOwner {
  const line = lines.find((entry) => entry.ownerId);

  if (!line?.ownerId) return { key: OUR_HOLDER_KEY, name: OUR_HOLDER_NAME };

  return { key: line.ownerId, name: line.ownerName ?? '' };
}
