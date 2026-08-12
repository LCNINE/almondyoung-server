export const SHOP_LISTING_REGIONS = [
  'seoul',
  'gyeonggi',
  'incheon',
  'busan',
  'daegu',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;

export type ShopListingRegion = (typeof SHOP_LISTING_REGIONS)[number];

export const SHOP_LISTING_BUSINESS_TYPES = [
  'nail',
  'lash',
  'semi-permanent',
  'skincare',
  'hair',
  'waxing',
  'tattoo',
  'etc',
] as const;

export type ShopListingBusinessType = (typeof SHOP_LISTING_BUSINESS_TYPES)[number];

/** transfer = 양도(권리금 받고 넘김), lease = 임대(자리만 빌려줌) */
export const SHOP_LISTING_DEAL_TYPES = ['transfer', 'lease'] as const;

export type ShopListingDealType = (typeof SHOP_LISTING_DEAL_TYPES)[number];
