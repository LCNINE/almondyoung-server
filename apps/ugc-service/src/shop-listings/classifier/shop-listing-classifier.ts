/**
 * 「샵 매매 글이 맞는가」 판정기의 포트. 공급사(Jev 등) SDK 타입을 여기 노출하지 않는다 —
 * 판정기를 갈 때 어댑터 하나만 바꾸면 되게 한다.
 */
export interface ShopListingClassifierInput {
  title: string;
  content: string;
  region: string | null;
  businessType: string | null;
  dealType: string | null;
  deposit: number | null;
  monthlyRent: number | null;
  keyMoney: number | null;
}

export interface ShopListingClassification {
  label: 'shop_listing' | 'not_shop_listing';
  /** 0~1, 보정된 확신도. */
  confidence: number;
}

export interface ShopListingClassifier {
  /** 판정할 수 없으면 null. */
  classify(input: ShopListingClassifierInput): Promise<ShopListingClassification | null>;
}

export const SHOP_LISTING_CLASSIFIER = Symbol('SHOP_LISTING_CLASSIFIER');

/** v1 — Jev 키가 나오기 전까지 모든 회원 글을 관리자 대기로 보낸다. */
export class NullShopListingClassifier implements ShopListingClassifier {
  classify(): Promise<ShopListingClassification | null> {
    return Promise.resolve(null);
  }
}
