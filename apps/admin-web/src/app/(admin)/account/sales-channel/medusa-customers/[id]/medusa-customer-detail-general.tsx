'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useMedusaCustomerById } from '@/lib/services/medusa-customers';
import { formatDate } from '@/lib/utils/date';

function formatName(firstName: string | null, lastName: string | null): string {
  const first = firstName ?? '';
  const last = lastName ?? '';
  return `${last}${first}`.trim() || '-';
}

export function MedusaCustomerDetailGeneralContent({
  customerId,
}: {
  customerId: string;
}) {
  const { data } = useMedusaCustomerById(customerId);

  const customer = data?.customer;

  const rows: { key: string; value: string | null }[] = [
    { key: 'ID', value: customer?.id ?? null },
    { key: '이메일', value: customer?.email ?? null },
    { key: '이름', value: formatName(customer?.first_name ?? null, customer?.last_name ?? null) },
    { key: '전화번호', value: customer?.phone ?? null },
    { key: '계정 여부', value: customer?.has_account ? '있음' : '없음' },
    { key: '가입일', value: formatDate(customer?.created_at) },
    { key: '수정일', value: formatDate(customer?.updated_at) },
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

export function MedusaCustomerDetailGeneral({
  customerId,
}: {
  customerId: string;
}) {
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
        <MedusaCustomerDetailGeneralContent customerId={customerId} />
      </Suspense>
    </Container>
  );
}
