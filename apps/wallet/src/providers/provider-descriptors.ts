export type ProviderKind = 'gateway' | 'ledger';

export type PaymentProviderCapability = 'checkout' | 'points' | 'manual_transfer' | 'recurring_billing' | 'refund';

export type PaymentProviderPublicExposure = 'checkout' | 'billing' | 'internal';

export interface PaymentProviderDescriptor {
  code: string;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  defaultSortOrder: number;
  kind: ProviderKind;
  capabilities: PaymentProviderCapability[];
  publicExposure: PaymentProviderPublicExposure;
}

export const PAYMENT_PROVIDER_DESCRIPTORS = {
  POINTS: {
    code: 'POINTS',
    displayName: '포인트',
    description: '내부 포인트 결제',
    defaultEnabled: true,
    defaultSortOrder: 10,
    kind: 'ledger',
    capabilities: ['points', 'checkout', 'refund'],
    publicExposure: 'checkout',
  },
  TOSS: {
    code: 'TOSS',
    displayName: '토스페이먼츠',
    description: '카드/간편결제 (토스페이먼츠)',
    defaultEnabled: true,
    defaultSortOrder: 20,
    kind: 'gateway',
    capabilities: ['checkout', 'refund'],
    publicExposure: 'checkout',
  },
  BANK_TRANSFER: {
    code: 'BANK_TRANSFER',
    displayName: '무통장입금',
    description: '계좌 무통장 입금 (수동 확인)',
    defaultEnabled: true,
    defaultSortOrder: 30,
    kind: 'gateway',
    capabilities: ['checkout', 'manual_transfer', 'refund'],
    publicExposure: 'checkout',
  },
  CMS_BATCH: {
    code: 'CMS_BATCH',
    displayName: 'CMS 자동이체',
    description: '효성 CMS 배치 출금',
    defaultEnabled: true,
    defaultSortOrder: 40,
    kind: 'gateway',
    capabilities: ['recurring_billing'],
    publicExposure: 'billing',
  },
} as const satisfies Record<string, PaymentProviderDescriptor>;

export const DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS = Object.values(PAYMENT_PROVIDER_DESCRIPTORS);
