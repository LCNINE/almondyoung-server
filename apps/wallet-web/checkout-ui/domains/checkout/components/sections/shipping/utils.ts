import { StoreCartAddress } from '@medusajs/types';
import { SHIPPING_MEMO_OPTIONS } from './constants';
import type { FormattedAddress, ShippingMemo } from './types';
import { formatPhoneNumber } from '@/checkout-ui/lib/utils/format-phone-number';
import { buildAddressLine } from '@/checkout-ui/lib/utils/address-line';

// cart.metadata 에 저장된 배송메모를 ShippingMemo 형태로 읽는다. 저장값이 없으면 빈 메모.
export const readShippingMemo = (metadata: Record<string, unknown> | null | undefined): ShippingMemo => ({
  type: (metadata?.shipping_memo_type as string) || '',
  custom: (metadata?.shipping_memo_custom as string) || '',
  hasEntrance: (metadata?.has_entrance as boolean) || false,
  entrancePassword: (metadata?.entrance_password as string) || '',
});

// 두 배송메모가 완전히 같은지 비교한다. 카트에 이미 같은 값이 있으면 결제 시 재저장을 건너뛰는 데 쓴다.
export const isSameShippingMemo = (a: ShippingMemo, b: ShippingMemo): boolean =>
  a.type === b.type &&
  a.custom === b.custom &&
  a.hasEntrance === b.hasEntrance &&
  a.entrancePassword === b.entrancePassword;

export const isValidAddress = (address: StoreCartAddress | null): boolean => {
  if (!address) return false;

  const hasName = !!(address.first_name || address.last_name);
  const hasAddress = !!(address.province || address.city || address.address_1 || address.address_2);
  const hasPhone = !!address.phone;

  return hasName || hasAddress || hasPhone;
};

export const formatAddress = (address: StoreCartAddress | null): FormattedAddress => {
  if (!address) {
    return {
      name: '',
      phone: '',
      postalCode: '',
      address1: '',
      address2: '',
      fullAddress: '',
    };
  }

  const name = [address.first_name, address.last_name].filter(Boolean).join(' ');
  const phone = address.phone ? formatPhoneNumber(address.phone) : '';
  const postalCode = address.postal_code ?? '';
  const address1 = address.address_1 ?? '';
  const address2 = address.address_2 ?? '';
  const fullAddress = buildAddressLine({
    province: address.province,
    city: address.city,
    address1,
    address2,
  });

  return { name, phone, postalCode, address1, address2, fullAddress };
};

export const formatShippingMemo = (memo: ShippingMemo, t: (key: string) => string): string => {
  if (!memo.type) return '';

  if (memo.type === 'other') return memo.custom.trim();

  const option = SHIPPING_MEMO_OPTIONS.find((o) => o.value === memo.type);
  if (!option) return '';

  const label = t(`options.${option.labelKey}`);
  if (memo.type !== 'door') return label;

  const password = memo.entrancePassword.trim();
  if (memo.hasEntrance && password) {
    return `${label} (${t('entrance.heading')} ${password})`;
  }
  return label;
};

export type ShippingMemoError = 'selectMemo' | 'enterEntrancePw' | 'enterCustomMemo';

export const findShippingMemoError = (memo: ShippingMemo): ShippingMemoError | null => {
  if (!memo.type) return 'selectMemo';
  if (memo.type === 'other' && !memo.custom.trim()) return 'enterCustomMemo';
  if (memo.type === 'door' && memo.hasEntrance && !memo.entrancePassword.trim()) return 'enterEntrancePw';
  return null;
};
