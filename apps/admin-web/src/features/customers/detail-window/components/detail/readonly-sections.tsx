'use client';

import { CalendarClock, Store, FileCheck2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useShopInfoByUserId, useUserConsent } from '@/lib/services/customers';
import type { CustomerProfile } from '@/lib/types/dto/customers';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { BlacklistSetting } from '../blacklist-setting';
import { Field, SectionCard } from './_ui';

const SHOP_TYPE_LABELS: Record<string, string> = {
  solo: '1인 샵',
  small: '소규모 샵',
  large: '대형 샵',
};

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

/** 샵 정보 (조회 전용 — admin 수정 API 없음) */
export function ShopSection({ userId }: { userId: string }) {
  const { data: shop, isLoading } = useShopInfoByUserId(userId);
  const categories = asStringList(shop?.categories);

  return (
    <SectionCard title="샵 정보" icon={<Store className="size-4 text-sky-500" />}>
      {isLoading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : !shop ? (
        <div className="py-6 text-center text-sm text-gray-400">
          등록된 샵 정보가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <Field
              label="샵 유형"
              value={
                shop.shopType
                  ? (SHOP_TYPE_LABELS[shop.shopType] ?? shop.shopType)
                  : null
              }
            />
            <Field label="운영 여부" value={shop.isOperating ? '운영중' : '미운영'} />
            <Field
              label="운영 기간"
              value={shop.yearsOperating ? `${shop.yearsOperating}년차` : null}
            />
          </div>
          <div>
            <Field
              label="카테고리"
              value={
                categories.length ? (
                  <span className="flex flex-wrap gap-1">
                    {categories.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                  </span>
                ) : null
              }
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function YesNo({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? 'default' : 'secondary'}>
      {value ? '동의' : '미동의'}
    </Badge>
  );
}

/** 약관/마케팅 동의 현황 (조회 전용) */
export function ConsentSection({ userId }: { userId: string }) {
  const { data: consent, isLoading } = useUserConsent(userId);

  return (
    <SectionCard
      title="약관 / 마케팅 동의"
      icon={<FileCheck2 className="size-4 text-violet-500" />}
    >
      {isLoading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : !consent ? (
        <div className="py-6 text-center text-sm text-gray-400">
          아직 약관에 동의하지 않은 회원입니다.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <Field label="만 14세 이상" value={<YesNo value={consent.isOver14} />} />
            <Field
              label="이용약관"
              value={<YesNo value={consent.termsOfService} />}
            />
            <Field
              label="개인정보 처리방침"
              value={<YesNo value={consent.privacyPolicy} />}
            />
          </div>
          <div>
            <Field
              label="전자금융거래"
              value={<YesNo value={consent.electronicTransaction} />}
            />
            <Field
              label="제3자 제공"
              value={<YesNo value={consent.thirdPartySharing} />}
            />
            <Field
              label="마케팅 수신"
              value={<YesNo value={consent.marketingConsent} />}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** 계정 상태 + 블랙리스트 */
export function AccountStatusSection({
  userId,
  customer,
}: {
  userId: string;
  customer: CustomerProfile;
}) {
  return (
    <SectionCard
      title="계정 상태"
      icon={<CalendarClock className="size-4 text-gray-500" />}
      action={<BlacklistSetting userId={userId} />}
    >
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <Field
            label="이메일 인증"
            value={customer.isEmailVerified ? '인증완료' : '미인증'}
          />
          <Field label="가입일" value={formatDate(customer.createdAt)} />
        </div>
        <div>
          <Field
            label="최근 활동일"
            value={formatDateTime(customer.lastActivityAt)}
          />
        </div>
      </div>
    </SectionCard>
  );
}
