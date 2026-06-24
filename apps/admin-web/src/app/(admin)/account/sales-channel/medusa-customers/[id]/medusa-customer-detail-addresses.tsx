'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useMedusaCustomerById } from '@/lib/services/medusa-customers';
import type { AdminCustomer, AdminCustomerAddress } from '@medusajs/types';
import { Badge } from '@/components/ui/badge';
import { CustomerAddressCreateDialog } from '@/features/medusa-customers/components/customer-address-create-dialog';

function AddressCard({
  customer,
  address,
}: {
  customer: AdminCustomer;
  address: AdminCustomerAddress;
}) {
  const fullName = [address.last_name, address.first_name]
    .filter(Boolean)
    .join('');
  const fullAddress = [
    address.city,
    address.province,
    address.address_1,
    address.address_2,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="border-b p-4 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{address.address_name || '주소'}</span>
          {address.is_default_shipping && (
            <Badge variant="secondary">기본 배송지</Badge>
          )}
          {address.is_default_billing && (
            <Badge variant="outline">기본 청구지</Badge>
          )}
        </div>
        <CustomerAddressCreateDialog customer={customer} address={address} />
      </div>
      <div className="space-y-1 text-sm text-gray-600">
        {fullName && <p>{fullName}</p>}
        {fullAddress && <p>{fullAddress}</p>}
        {address.postal_code && <p>우편번호: {address.postal_code}</p>}
        {address.phone && <p>전화: {address.phone}</p>}
        {address.company && <p>회사: {address.company}</p>}
      </div>
    </div>
  );
}

export function MedusaCustomerDetailAddressesContent({
  customerId,
}: {
  customerId: string;
}) {
  const { data } = useMedusaCustomerById(customerId);

  const customer = data?.customer;
  const addresses = customer?.addresses ?? [];

  if (addresses.length === 0) {
    return (
      <div>
        <div className="flex justify-end border-b px-4 py-3">
          <CustomerAddressCreateDialog customer={customer} />
        </div>
        <div className="p-4 text-center text-sm text-gray-500">
          등록된 주소가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end border-b px-4 py-3">
        <CustomerAddressCreateDialog customer={customer} />
      </div>
      {addresses.map((address) => (
        <AddressCard key={address.id} customer={customer} address={address} />
      ))}
    </div>
  );
}

export function MedusaCustomerDetailAddresses({
  customerId,
}: {
  customerId: string;
}) {
  return (
    <Container className="divide-y">
      <Header title="주소 정보" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <MedusaCustomerDetailAddressesContent customerId={customerId} />
      </Suspense>
    </Container>
  );
}
