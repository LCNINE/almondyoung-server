import type { ReactNode } from 'react';
import { CreditCard, Landmark, Smartphone, Wallet } from 'lucide-react';

export interface BankTransferPendingAction {
  type: 'BANK_TRANSFER_PENDING';
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  amount?: number;
  currency?: string;
}

export function getMethodIcon(type: string): ReactNode {
  switch (type) {
    case 'TOSS':
      return <Smartphone className="w-5 h-5" />;
    case 'CARD':
      return <CreditCard className="w-5 h-5" />;
    case 'BALANCE':
      return <Wallet className="w-5 h-5" />;
    case 'BANK_TRANSFER':
      return <Landmark className="w-5 h-5" />;
    default:
      return <CreditCard className="w-5 h-5" />;
  }
}

// region(countryCode)별 사람이 읽는 이름. 미정의 코드는 코드 그대로(대문자) 표시한다.
const REGION_LABELS: Record<string, string> = {
  kr: '대한민국',
  jp: '일본',
  us: '미국',
};

// 빈 결제수단 안내에서 "어느 지역으로 들어왔는지"를 명확히 보여주기 위한 라벨.
// 예: jp → "일본(JP)", fr → "FR". region 이 없으면 null.
export function getRegionLabel(region?: string | null): string | null {
  const code = region?.trim();
  if (!code) return null;
  const upper = code.toUpperCase();
  const name = REGION_LABELS[code.toLowerCase()];
  return name ? `${name}(${upper})` : upper;
}

export function formatAmount(amount: number, currency: string): string {
  if (currency === 'KRW') {
    return `${amount.toLocaleString('ko-KR')}원`;
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

/**
 * 무통장입금 대기 화면에서 storefront 주문내역으로 보내기 위한 URL 을 구성한다.
 * wallet-web 과 storefront 는 서로 다른 origin 이므로 intent.returnUrl(스토어프론트 origin 포함)에서
 * origin 을 가져오고 region(countryCode)으로 경로를 만든다. returnUrl 이 없으면 null.
 */
export function buildStorefrontOrderListUrl(returnUrl?: string | null, region?: string | null): string | null {
  if (!returnUrl) return null;
  try {
    const url = new URL(returnUrl);
    const firstSegment = url.pathname.split('/').filter(Boolean)[0];
    const countryCode = (region?.trim() || firstSegment || 'kr').toLowerCase();
    // 스토어프론트가 이 표시를 보고 주문이 아직 안 보이면 잠깐 자동 재조회한다(고객이 직접 새로고침하지 않도록).
    return `${url.origin}/${countryCode}/mypage/order/list?justOrdered=1`;
  } catch {
    return null;
  }
}

export function isBankTransferPendingAction(value: unknown): value is BankTransferPendingAction {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'BANK_TRANSFER_PENDING';
}
