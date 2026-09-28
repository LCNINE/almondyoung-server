'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  SmsAudienceSummary,
  SmsRecipientGroup,
} from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/ui';

export const ALL_MEMBERS = 'all-members';

function TargetCard({
  selected,
  onSelect,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-1 rounded-md border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-foreground bg-muted/60 ring-foreground ring-1'
          : 'hover:bg-muted/40'
      )}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground text-xs">{children}</span>
    </button>
  );
}

export function TargetPicker({
  value,
  onChange,
  audience,
  groups,
  isMarketing,
}: {
  value: string;
  onChange: (value: string) => void;
  audience: SmsAudienceSummary | undefined;
  groups: SmsRecipientGroup[] | undefined;
  isMarketing: boolean;
}) {
  const missing =
    value !== ALL_MEMBERS &&
    groups !== undefined &&
    !groups.some((g) => g.id === value);

  return (
    <div
      role="radiogroup"
      className="flex min-h-[320px] flex-1 flex-col gap-2 rounded-md border p-4 text-sm"
    >
      <TargetCard
        selected={value === ALL_MEMBERS}
        onSelect={() => onChange(ALL_MEMBERS)}
        title={
          audience
            ? `아몬드영 회원 전체 ${(isMarketing ? audience.consented : audience.withPhone).toLocaleString()}명`
            : '아몬드영 회원 전체'
        }
      >
        {audience
          ? `휴대폰 번호가 있는 회원 ${audience.withPhone.toLocaleString()}명 중 ${isMarketing ? '마케팅 수신 동의자' : '전원'} (탈퇴·휴면 제외). 같은 번호를 쓰는 계정은 한 통만 받습니다.`
          : '대상 인원을 불러오는 중...'}
      </TargetCard>

      <p className="text-muted-foreground mt-2 text-xs font-medium">
        수신자 그룹
      </p>
      {groups?.map((group) => (
        <TargetCard
          key={group.id}
          selected={value === group.id}
          onSelect={() => onChange(group.id)}
          title={`${group.name} ${group.recipients.toLocaleString()}명`}
        >
          {isMarketing ? '수신거부한 번호는 빼고 보냅니다. ' : ''}
          {'{{이름}}'} 은 그룹에 넣은 이름(상호)으로 바뀝니다.
        </TargetCard>
      ))}
      {groups && groups.length === 0 && (
        <p className="text-muted-foreground text-xs">
          아직 만든 그룹이 없습니다.
        </p>
      )}
      {missing && (
        <p className="text-destructive text-xs">
          선택한 그룹을 찾을 수 없습니다. 다시 골라 주세요.
        </p>
      )}
      <Link
        href="/messages/groups"
        className="text-muted-foreground text-xs underline underline-offset-2"
      >
        수신자 그룹 만들기·관리
      </Link>
    </div>
  );
}
