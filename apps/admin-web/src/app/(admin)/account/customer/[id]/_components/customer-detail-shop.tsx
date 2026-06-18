'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useShopInfoByUserId } from '@/lib/services/customers';
import { formatDate } from '@/lib/utils/date';

const shopTypeLabels: Record<string, string> = {
  solo: '1인 샵',
  small: '소규모 샵',
  large: '대형 샵',
};

export function CustomerDetailShopContent({ userId }: { userId: string }) {
  const { data: shop, isLoading } = useShopInfoByUserId(userId);

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="p-4 text-sm text-center text-gray-500">
        등록된 샵 정보가 없습니다.
      </div>
    );
  }

  const rows: { key: string; value: string | null }[] = [
    { key: '운영 상태', value: shop.isOperating ? '운영중' : '미운영' },
    {
      key: '운영 기간',
      value: shop.yearsOperating ? `${shop.yearsOperating}년` : null,
    },
    {
      key: '샵 유형',
      value: shop.shopType
        ? (shopTypeLabels[shop.shopType] ?? shop.shopType)
        : null,
    },
    {
      key: '카테고리',
      value: Array.isArray(shop.categories) ? shop.categories.join(', ') : null,
    },
    {
      key: '타겟 고객',
      value: Array.isArray(shop.targetCustomers)
        ? shop.targetCustomers.join(', ')
        : null,
    },
    {
      key: '운영 요일',
      value: Array.isArray(shop.openDays) ? shop.openDays.join(', ') : null,
    },
    { key: '등록일', value: formatDate(shop.createdAt) },
    { key: '수정일', value: formatDate(shop.updatedAt) },
  ];

  return (
    <div>
      {rows.map(({ key, value }) => (
        <div key={key} className="grid grid-cols-2 p-3">
          <div className="text-sm font-medium text-gray-500">{key}</div>
          <div className="text-sm">{value ?? '-'}</div>
        </div>
      ))}
    </div>
  );
}

export function CustomerDetailShop({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="샵 정보" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <CustomerDetailShopContent userId={userId} />
      </Suspense>
    </Container>
  );
}
