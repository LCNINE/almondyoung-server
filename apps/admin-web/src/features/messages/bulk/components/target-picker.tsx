'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  SmsAudienceSummary,
  SmsRecipientGroup,
} from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/ui';

export interface TargetSelection {
  includeMembers: boolean;
  groupIds: string[];
}

function TargetCard({
  selected,
  onToggle,
  title,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-foreground bg-muted/60 ring-foreground ring-1'
          : 'hover:bg-muted/40'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
          selected
            ? 'border-foreground bg-foreground text-background'
            : 'border-muted-foreground/50'
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground text-xs">{children}</span>
      </span>
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
  value: TargetSelection;
  onChange: (value: TargetSelection) => void;
  audience: SmsAudienceSummary | undefined;
  groups: SmsRecipientGroup[] | undefined;
  isMarketing: boolean;
}) {
  const toggleGroup = (id: string) =>
    onChange({
      ...value,
      groupIds: value.groupIds.includes(id)
        ? value.groupIds.filter((g) => g !== id)
        : [...value.groupIds, id],
    });
  const missing =
    groups !== undefined &&
    value.groupIds.some((id) => !groups.some((g) => g.id === id));
  const multiple = Number(value.includeMembers) + value.groupIds.length > 1;

  return (
    <div className="flex min-h-[320px] flex-1 flex-col gap-2 rounded-md border p-4 text-sm">
      <p className="text-muted-foreground text-xs">
        여러 개를 고를 수 있습니다. 겹치는 번호에는 한 통만 보냅니다.
      </p>
      <TargetCard
        selected={value.includeMembers}
        onToggle={() =>
          onChange({ ...value, includeMembers: !value.includeMembers })
        }
        title={
          audience
            ? `아몬드영 회원 전체 ${(isMarketing ? audience.consented : audience.withPhone).toLocaleString()}명`
            : '아몬드영 회원 전체'
        }
      >
        {audience
          ? `휴대폰 번호가 있는 회원 ${audience.withPhone.toLocaleString()}명 중 ${isMarketing ? '마케팅 수신 동의자' : '전원'} (탈퇴·휴면 제외).`
          : '대상 인원을 불러오는 중...'}
      </TargetCard>

      <p className="text-muted-foreground mt-2 text-xs font-medium">
        수신자 그룹
      </p>
      {groups?.map((group) => (
        <TargetCard
          key={group.id}
          selected={value.groupIds.includes(group.id)}
          onToggle={() => toggleGroup(group.id)}
          title={`${group.name} ${group.recipients.toLocaleString()}명`}
        >
          {isMarketing
            ? '수신거부한 번호와 광고에 동의하지 않은 회원 번호는 빼고 보냅니다. '
            : ''}
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
          고른 그룹 중 사라진 것이 있습니다. 다시 골라 주세요.
        </p>
      )}
      {multiple && (
        <p className="text-muted-foreground text-xs">
          정확한 인원(중복을 합친 수)은 발송하기를 누르면 확인창에 나옵니다.
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
