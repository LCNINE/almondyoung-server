'use client';

import { Star, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerById } from '@/lib/services/customers';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { BlacklistSetting } from '../blacklist-setting';

function membershipLabel(roles: string[] | undefined): string {
  if (!roles?.length) return '일반 회원';
  if (roles.includes('membership')) return '멤버십 회원';
  return '일반 회원';
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <User className="size-4 text-indigo-500" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-24 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-900">{value ?? '-'}</span>
    </div>
  );
}

export function HomeTab({ customerId }: { customerId: string }) {
  const { data: customer, isLoading } = useCustomerById(customerId);
  const profile = customer?.profile;

  if (isLoading) {
    return <div className="text-sm text-gray-400">불러오는 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 우측 상단 액션바 */}
      <div className="flex justify-end gap-2">
        <BlacklistSetting userId={customerId} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="준비 중"
        >
          <Star className="mr-1 h-4 w-4" />
          단골리스트 설정
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-4">
        {/* 기본정보 */}
        <Card title="기본정보">
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Field label="아이디" value={customer?.loginId ?? null} />
              <Field label="이름" value={customer?.username ?? null} />
              <Field
                label="휴대폰"
                value={
                  profile?.phoneNumber
                    ? formatPhoneNumber(profile.phoneNumber)
                    : null
                }
              />
              <Field label="Email" value={customer?.email ?? null} />
              <Field label="주소" value={profile?.address ?? null} />
            </div>
            <div>
              <Field
                label="회원등급"
                value={membershipLabel(customer?.roles)}
              />
              <Field
                label="이메일 인증"
                value={customer?.isEmailVerified ? '인증완료' : '미인증'}
              />
              <Field
                label="가입일"
                value={formatDate(customer?.createdAt)}
              />
              <Field
                label="최근 활동일"
                value={formatDate(customer?.lastActivityAt)}
              />
            </div>
          </div>
        </Card>

        {/* 메모 (단계 2에서 연동) */}
        <Card title="메모">
          <div className="text-sm text-gray-400">내용 없음</div>
        </Card>
      </div>

      {/* 주문정보 (단계 2에서 연동) */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-gray-800">
          주문정보
        </div>
        <div className="py-8 text-center text-sm text-gray-400">
          주문 데이터 연동 예정
        </div>
      </section>
    </div>
  );
}
