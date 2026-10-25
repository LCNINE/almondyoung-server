import type { SupplierDto } from '@/lib/types/dto/inventory';
import { directDeliverySuppliers } from './direct-delivery-suppliers';

const supplier = (
  id: string,
  isDirectDelivery: boolean | null | 'no-settings'
): SupplierDto => ({
  id,
  name: id,
  contact: null,
  address: null,
  businessInfo: null,
  purchaseSettings:
    isDirectDelivery === 'no-settings'
      ? null
      : { isDirectDelivery, orderCutoffTime: null },
  paymentInfo: null,
  description: null,
  memo: null,
  purchaseManagerId: null,
  defaultWarehouseId: null,
  categories: [],
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
});

describe('directDeliverySuppliers', () => {
  it('행의 isDirectDelivery 가 true 인 것만 — 파라미터를 버린 옛 core 가 전부를 돌려줘도 비직배는 빠진다', () => {
    const all = [
      supplier('d-1', true),
      supplier('n-1', false),
      supplier('n-2', null),
      supplier('n-3', 'no-settings'),
      supplier('d-2', true),
    ];
    expect(directDeliverySuppliers(all).map((s) => s.id)).toEqual([
      'd-1',
      'd-2',
    ]);
  });
  it('목록이 없으면 빈 배열', () => {
    expect(directDeliverySuppliers(undefined)).toEqual([]);
  });
});
