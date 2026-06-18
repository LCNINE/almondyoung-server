'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useCustomerById } from '@/lib/services/customers';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber } from '@/lib/utils/phone';

export function CustomerDetailGeneralContent({
  customerId,
}: {
  customerId: string;
}) {
  const { data: customer } = useCustomerById(customerId);
  console.log('data:', customer);
  const profile = customer?.profile;

  const rows: { key: string; value: string | null }[] = [
    { key: '로그인 ID', value: customer?.loginId ?? null },
    { key: '이름', value: customer?.username ?? null },
    { key: '닉네임', value: customer?.nickname ?? null },
    { key: '이메일', value: customer?.email ?? null },
    {
      key: '전화번호',
      value: profile?.phoneNumber
        ? formatPhoneNumber(profile.phoneNumber)
        : null,
    },
    { key: '생년월일', value: formatDate(profile?.birthDate) },
    { key: '주소', value: profile?.address ?? null },
    { key: '최근 활동일', value: formatDate(customer?.lastActivityAt) },
    { key: '가입일', value: formatDate(customer?.createdAt) },
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

export function CustomerDetailGeneral({ customerId }: { customerId: string }) {
  return (
    <Container className="divide-y">
      <Header title="기본 정보" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <CustomerDetailGeneralContent customerId={customerId} />
      </Suspense>
    </Container>
  );
}
