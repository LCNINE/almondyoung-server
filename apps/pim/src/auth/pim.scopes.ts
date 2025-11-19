import { ScopeDefinition } from '@app/authorization';

export const PIM_SCOPES: ScopeDefinition[] = [
  { key: 'product:read', category: 'product', description: '상품 조회' },
  { key: 'product:write', category: 'product', description: '상품 생성/수정' },
  { key: 'product:delete', category: 'product', description: '상품 삭제' },
  { key: 'category:read', category: 'category', description: '카테고리 조회' },
  { key: 'category:write', category: 'category', description: '카테고리 생성/수정' },
  { key: 'category:delete', category: 'category', description: '카테고리 삭제' },
  { key: 'supplier:read', category: 'supplier', description: '공급업체 조회' },
  { key: 'supplier:write', category: 'supplier', description: '공급업체 생성/수정' },
  { key: 'brand:read', category: 'brand', description: '브랜드 조회' },
  { key: 'brand:write', category: 'brand', description: '브랜드 생성/수정' },
];

