export type ProductAiSource = { id: string; title: string; href: string; content: string };

// Versioned operational references shared by the model context and the human-readable page.
export const PRODUCT_AI_GUIDES: ProductAiSource[] = [
  {
    id: 'category-v1',
    title: '카테고리와 대표카테고리',
    href: '/mall/product-ai/guide#category-v1',
    content:
      '카테고리는 상품을 분류하는 기준입니다. 대표카테고리는 상품에 연결한 카테고리 중 대표 하나입니다. 대표 선택만으로 검색 순위나 노출 효과가 보장되지는 않습니다. 현재 챗봇은 카테고리를 조회하거나 생성·변경하지 않습니다. 어드민 상품관리의 분류/카테고리 메뉴에서 기존 분류를 확인하세요.',
  },
  {
    id: 'pricing-v1',
    title: '판매가·회원가·공급가 구분',
    href: '/mall/product-ai/guide#pricing-v1',
    content:
      '일반 판매가, 멤버십 가격, 공급가는 별도 정보입니다. 멤버십 가격 설정, 비회원에게 멤버십 가격 숨김, 회원에게만 상품 노출, 회원만 구매 가능은 서로 다른 정책입니다. 가격이나 공급가는 추측해서 채우지 않고 운영자가 제공한 금액과 실제 가격 규칙을 확인해야 합니다. 현재 챗봇은 가격을 조회하거나 저장하지 않습니다.',
  },
  {
    id: 'inventory-v1',
    title: '재고 매칭과 SKU 생성',
    href: '/mall/product-ai/guide#inventory-v1',
    content:
      '상품 옵션별로 기존 재고 품목(SKU)을 연결할지 먼저 확인합니다. SKU 생성은 재고 품목을 정의하는 작업이며 실제 수량 입고나 재고 조정과 다릅니다. 재고 품목을 새로 만들었다고 수량이 입고된 것은 아닙니다. 현재 챗봇은 SKU 조회·생성·매칭·입고를 실행하지 않습니다.',
  },
];

export function selectProductAiGuides(question: string): ProductAiSource[] {
  return PRODUCT_AI_GUIDES.filter((guide) =>
    guide.id === 'category-v1'
      ? /카테고리|분류/.test(question)
      : guide.id === 'pricing-v1'
        ? /가격|판매가|공급가|회원가|멤버십|회원/.test(question)
        : /재고|매칭|입고|sku/i.test(question),
  );
}
