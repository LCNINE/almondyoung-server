'use client';

import { CheckCircle2, Phone, Mail } from 'lucide-react';
import { useCustomerById } from '@/lib/services/customers';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber } from '@/lib/utils/phone';

// 멤버십 역할 여부로 등급 라벨을 추정한다 (정식 등급 체계 들어오면 교체).
function membershipLabel(roles: string[] | undefined): string {
  if (!roles?.length) return '일반 회원';
  if (roles.includes('membership')) return '멤버십 회원';
  return '일반 회원';
}

const shopTypeLabels: Record<string, string> = {
  solo: '1인 샵',
  small: '소규모 샵',
  large: '대형 샵',
};

/** 좌측 상단 회원 요약 카드 */
export function MemberSummary({ customerId }: { customerId: string }) {
  const { data: customer, isLoading } = useCustomerById(customerId);
  const profile = customer?.profile;
  const shop = customer?.shop;

  if (isLoading) {
    return (
      <div className="border-b border-gray-200 p-4 text-sm text-gray-400">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="border-b border-gray-200 p-4">
      {/* 이름 + 로그인ID + 인증 */}
      <div className="flex items-center gap-1.5">
        <span className="text-base font-bold text-gray-900">
          {customer?.username ?? '-'}
        </span>
        <span className="truncate text-xs text-gray-400">
          {customer?.loginId ?? ''}
        </span>
        {customer?.isEmailVerified && (
          <CheckCircle2 className="size-4 shrink-0 text-green-500" />
        )}
      </div>

      {/* 멤버십 배지 */}
      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
        ⭐ {membershipLabel(customer?.roles)}
      </div>

      {/* 샵 한 줄 정보 (유형 · 운영기간) */}
      {shop && (
        <div className="mt-2 text-xs text-gray-500">
          {[
            shop.shopType
              ? (shopTypeLabels[shop.shopType] ?? shop.shopType)
              : null,
            shop.yearsOperating ? `${shop.yearsOperating}년차` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      {/* 최근 방문일 */}
      <div className="mt-1 text-xs text-gray-400">
        최근방문일 : {formatDate(customer?.lastActivityAt)}
      </div>

      {/* 연락처 */}
      <div className="mt-3 space-y-1.5 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <Phone className="size-3.5 text-gray-400" />
          <span>
            {profile?.phoneNumber
              ? formatPhoneNumber(profile.phoneNumber)
              : '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Mail className="size-3.5 text-gray-400" />
          <span className="truncate">{customer?.email ?? '-'}</span>
        </div>
      </div>
    </div>
  );
}
