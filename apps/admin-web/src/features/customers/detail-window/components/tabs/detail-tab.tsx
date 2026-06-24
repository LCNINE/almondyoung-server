'use client';

import { useCustomerById } from '@/lib/services/customers';
import { useMedusaCustomerByEmail } from '@/lib/services/medusa-customers';
import { BasicInfoSection } from '../detail/basic-info-section';
import { BusinessLicenseSection } from '../detail/business-license-section';
import {
  AccountStatusSection,
  ConsentSection,
  ShopSection,
} from '../detail/readonly-sections';
import { RolesSection } from '../detail/roles-section';
import { ShippingAddressesSection } from '../detail/shipping-addresses-section';

export function DetailTab({ customerId }: { customerId: string }) {
  const { data: customer, isLoading } = useCustomerById(customerId);

  // user-service 회원 ↔ Medusa 고객은 이메일로 매칭한다 (홈 탭과 동일).
  const email = customer?.email ?? '';
  const { data: medusaCustomerRes } = useMedusaCustomerByEmail(email);
  const medusaCustomerId = medusaCustomerRes?.customers?.[0]?.id;

  if (isLoading) {
    return <div className="text-sm text-gray-400">불러오는 중…</div>;
  }

  if (!customer) {
    return (
      <div className="py-8 text-center text-sm text-red-400">
        회원 정보를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BasicInfoSection userId={customerId} customer={customer} />
      <BusinessLicenseSection userId={customerId} />
      <ShippingAddressesSection medusaCustomerId={medusaCustomerId} />
      <RolesSection userId={customerId} />
      <div className="grid grid-cols-2 gap-4">
        <ShopSection userId={customerId} />
        <ConsentSection userId={customerId} />
      </div>
      <AccountStatusSection userId={customerId} customer={customer} />
    </div>
  );
}
