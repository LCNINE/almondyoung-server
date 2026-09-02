'use client';

import { CheckCircle2, Phone, Mail } from 'lucide-react';
import { useCustomerById } from '@/lib/services/customers';
import { useMemberDetail } from '@/lib/services/membership';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber } from '@/lib/utils/phone';

const shopTypeLabels: Record<string, string> = {
  solo: '1인 샵',
  small: '소규모 샵',
  large: '대형 샵',
};

const roleBadgeLabels: Record<string, string> = {
  master: '마스터',
  admin: '관리자',
};

/** 좌측 상단 회원 요약 카드 */
export function MemberSummary({ customerId }: { customerId: string }) {
  const { data: customer, isLoading } = useCustomerById(customerId);
  const { data: membership } = useMemberDetail(customerId);
  const isMember =
    membership?.status === 'ACTIVE' || membership?.status === 'PAUSED';
  const profile = customer?.profile;
  const shop = customer?.shop;

  // 멤버십 상태 + 보유 역할
  const badges = [
    isMember ? '멤버십 회원' : '일반 회원',
    ...(customer?.roles ?? [])
      .map((role) => roleBadgeLabels[role])
      .filter(Boolean),
  ];

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-gray-400 border-b border-gray-200">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-gray-200">
      {/* 이름 + 로그인ID + 인증 */}
      <div className="flex items-center gap-1.5">
        <span className="text-base font-bold text-gray-900">
          {customer?.username ?? '-'}
        </span>
        <span className="text-xs text-gray-400 truncate">
          {customer?.loginId ?? ''}
        </span>
        {customer?.isEmailVerified && (
          <CheckCircle2 className="text-green-500 size-4 shrink-0" />
        )}
      </div>

      {/* 탈퇴·휴면은 다른 정보보다 먼저 보여야 한다 — 응대 판단이 여기서 갈린다. */}
      {customer?.deletedAt ? (
        <div className="px-2 py-1 mt-2 text-xs font-medium text-red-700 rounded-md bg-red-50">
          탈퇴 회원 · {formatDate(customer.deletedAt)} 탈퇴
        </div>
      ) : customer?.dormantAt ? (
        <div className="px-2 py-1 mt-2 text-xs font-medium text-gray-700 rounded-md bg-gray-100">
          휴면 회원 · {formatDate(customer.dormantAt)} 전환
        </div>
      ) : null}

      {/* 멤버십 상태 + 역할 배지 */}
      <div className="flex flex-wrap gap-1 mt-2">
        {badges.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-amber-50 text-amber-700"
          >
            ⭐ {label}
          </span>
        ))}
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
