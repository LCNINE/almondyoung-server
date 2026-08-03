'use client';

import { useSuppliers } from '@/lib/services/inventory';
import { PlaceholderCell } from './common/placeholder-cell';

// 공급처 이름은 inventory BC 소유라 상품 목록 API 가 id 만 준다.
// react-query 캐시가 목록을 공유하므로 셀마다 호출해도 요청은 1회다.
export function SupplierCell({
  supplierId,
}: {
  supplierId: string | null | undefined;
}) {
  const { data } = useSuppliers({ limit: 100 });

  if (!supplierId) return <PlaceholderCell />;
  const name = data?.data?.find((s) => s.id === supplierId)?.name;
  return <span>{name ?? '-'}</span>;
}
