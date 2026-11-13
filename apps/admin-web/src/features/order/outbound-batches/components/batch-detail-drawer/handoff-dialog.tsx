'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounced } from '@/hooks/use-debounced';
import { useCan } from '@/hooks/use-permission';
import { permissionLabel } from '@/lib/auth/permission-labels';
import {
  STAFF_CANDIDATE_LIMIT,
  useAdminUsers,
} from '@/lib/services/users/queries';

export type HandoffClaim = 'picker' | 'packer';

export interface HandoffTarget {
  id: string;
  label: string;
}

const CLAIM_WORD: Record<HandoffClaim, string> = {
  picker: '피킹',
  packer: '포장',
};

const HANDOFF_REASONS = ['근무 교대', '작업자 부재'];

/** 출고 현장 작업 권한이 있는 직원만 받을 사람으로 고른다 — 권한이 없으면 앱에서 이어서 일할 수 없다. */
function useHandoffCandidates(ownerId: string, keyword: string) {
  const canReadAccounts = useCan(['customer.profile.read']);
  const allowed = canReadAccounts.status === 'ready' && canReadAccounts.allowed;
  const search = useDebounced(keyword, 250);
  const { data, isPending, isError, isPlaceholderData } = useAdminUsers(
    {
      audience: 'staff',
      holding: 'fulfillment.warehouse.operate',
      // 직원이 한 번에 받는 수보다 많아도 찾을 수 있게 검색어는 서버가 거른다
      q: search || undefined,
      limit: STAFF_CANDIDATE_LIMIT,
    },
    { enabled: allowed }
  );
  const candidates = useMemo(
    () =>
      (allowed ? (data?.data ?? []) : [])
        .filter((user) => user.holdsPermission && user.id !== ownerId)
        .map((user) => ({
          id: user.id,
          name: user.username || user.loginId,
          loginId: user.loginId,
        })),
    [allowed, data, ownerId]
  );
  const blockedReason =
    canReadAccounts.status === 'ready' && !canReadAccounts.allowed
      ? `${permissionLabel('customer.profile.read')} 권한이 있어야 받을 작업자를 고를 수 있어요.`
      : null;
  return {
    candidates,
    blockedReason,
    // 앞 검색어의 결과로 «없어요»라고 하지 않게, 새 검색어의 응답이 올 때까지는 찾는 중이다
    loading: allowed && (isPending || isPlaceholderData || search !== keyword),
    failed: allowed && isError,
  };
}

export function HandoffDialog({
  claim,
  itemLabel,
  ownerId,
  ownerName,
  submitting,
  onClose,
  onConfirm,
}: {
  claim: HandoffClaim;
  itemLabel: string;
  ownerId: string;
  ownerName: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (target: HandoffTarget, reason: string) => void;
}) {
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLowerCase();
  const { candidates, blockedReason, loading, failed } = useHandoffCandidates(
    ownerId,
    keyword
  );
  const [target, setTarget] = useState<HandoffTarget | null>(null);
  const [reason, setReason] = useState(HANDOFF_REASONS[0]);
  const word = CLAIM_WORD[claim];

  const matches = keyword
    ? candidates.filter(
        (user) =>
          user.name.toLowerCase().includes(keyword) ||
          user.loginId.toLowerCase().includes(keyword)
      )
    : candidates;

  const listMessage = blockedReason
    ? blockedReason
    : loading
      ? '작업자 목록을 불러오는 중…'
      : failed
        ? '작업자 목록을 불러오지 못했어요. 창을 닫았다가 다시 열어 주세요.'
        : !keyword
          ? '넘겨받을 수 있는 작업자가 없어요. 출고 현장 작업 권한이 있는 직원만 나와요.'
          : '이름이나 아이디가 맞는 작업자가 없어요.';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{word} 넘기기</DialogTitle>
          <DialogDescription>
            {itemLabel} · 지금 {word} 담당은 <b>{ownerName}</b>이에요. 근무
            교대처럼 맡은 사람이 끝까지 못 할 때 다른 작업자에게 넘겨요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label id="handoff-target-label">넘겨받을 작업자</Label>
          <Command
            shouldFilter={false}
            className="h-auto rounded-md border"
            aria-labelledby="handoff-target-label"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="이름이나 아이디로 찾기"
              disabled={!!blockedReason}
            />
            <CommandList className="max-h-52">
              {matches.length === 0 ? (
                <CommandEmpty className="px-3 py-4 text-sm text-muted-foreground">
                  {listMessage}
                </CommandEmpty>
              ) : (
                matches.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() =>
                      setTarget({
                        id: user.id,
                        label: `${user.name} (${user.loginId})`,
                      })
                    }
                    aria-selected={target?.id === user.id}
                    className="justify-between"
                  >
                    <span>
                      {user.name}{' '}
                      <span className="text-muted-foreground">
                        ({user.loginId})
                      </span>
                    </span>
                    {target?.id === user.id && (
                      <Check className="size-4" aria-label="선택됨" />
                    )}
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
          <p className="text-sm" aria-live="polite">
            {target ? (
              <>
                받는 사람: <b>{target.label}</b>
              </>
            ) : (
              <span className="text-muted-foreground">
                받을 작업자를 골라 주세요.
              </span>
            )}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="handoff-reason">사유</Label>
          <Input
            id="handoff-reason"
            list="handoff-reason-suggestions"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <datalist id="handoff-reason-suggestions">
            {HANDOFF_REASONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={!target || !reason.trim() || submitting}
            onClick={() => target && onConfirm(target, reason.trim())}
          >
            {submitting
              ? '넘기는 중…'
              : target
                ? `${target.label}에게 넘기기`
                : `${word} 넘기기`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
