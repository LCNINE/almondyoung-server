'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useBulkUpdatePolicy } from '@/lib/services/products';
import type { BulkUpdateFailureDto } from '@/lib/types/dto/products';
import type { SelectedProductSnapshot } from '@/features/mall/products-list/components/table/products-list-selection-model';
import { BulkFailureList } from '@/features/mall/bulk/components/bulk-failure-list';
import {
  flagStats,
  flagImpact,
  type PolicyFlag,
  type PolicyChoice,
} from './policy-counts';
import {
  buildPolicyPatch,
  hasAnyChange,
  type PolicyChoices,
} from './build-policy-patch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedItems: SelectedProductSnapshot[];
  onSuccess: () => void;
}

const ROWS: { flag: PolicyFlag; label: string; desc: string }[] = [
  {
    flag: 'hideMembershipPriceForNonMembers',
    label: '멤버십가 비공개',
    desc: '비회원에게 멤버십가 숫자 대신 "멤버십 회원 공개"를 표시합니다.',
  },
  {
    flag: 'isVisibleToMembersOnly',
    label: '멤버십 회원 전용 노출',
    desc: '비회원의 상품 목록·검색·상세 접근에서 숨깁니다.',
  },
  {
    flag: 'isOverseas',
    label: '해외직구',
    desc: '해외 배송 상품일 시 체크해주세요. 체크 시 주문 단계에서 개인통관고유부호 입력이 필수가 됩니다.',
  },
];

const INITIAL: PolicyChoices = {
  hideMembershipPriceForNonMembers: 'unchanged',
  isVisibleToMembersOnly: 'unchanged',
  isOverseas: 'unchanged',
};

export function BulkPolicyModal({
  open,
  onOpenChange,
  selectedIds,
  selectedItems,
  onSuccess,
}: Props) {
  const [choices, setChoices] = useState<PolicyChoices>(INITIAL);
  const [failedItems, setFailedItems] = useState<BulkUpdateFailureDto[]>([]);
  const bulkPolicy = useBulkUpdatePolicy();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setChoices(INITIAL);
      setFailedItems([]);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    const patch = buildPolicyPatch(choices);
    setFailedItems([]);
    try {
      const result = await bulkPolicy.mutateAsync({
        productIds: selectedIds,
        ...patch,
      });
      const failures = (result.failed ?? []).map((f) => ({
        ...f,
        name:
          f.name ??
          selectedItems.find((s) => s.masterId === f.masterId)?.name ??
          null,
      }));
      if (failures.length > 0) {
        setFailedItems(failures);
        toast.warning(
          `${result.updated}개 적용, ${failures.length}개 실패했습니다.`
        );
        onSuccess();
        return;
      }
      toast.success(`${result.updated}개 상품의 노출 정책이 변경되었습니다.`);
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>운영 노출 정책 일괄 변경</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            선택된 <strong>{selectedIds.length}개</strong> 상품에 적용됩니다.
            변경할 항목만 체크하고 켜기/끄기를 선택하세요.
          </p>

          {ROWS.map(({ flag, label, desc }) => {
            const stats = flagStats(selectedItems, flag);
            const choice = choices[flag];
            const impact = flagImpact(stats, choice);
            const willChange = choice !== 'unchanged';
            const setChoice = (next: PolicyChoice) =>
              setChoices((prev) => ({ ...prev, [flag]: next }));
            return (
              <div key={flag} className="rounded-md border p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <Label className="flex items-start gap-2 font-medium">
                    <Checkbox
                      checked={willChange}
                      onCheckedChange={(v) => setChoice(v ? 'on' : 'unchanged')}
                      aria-label={`${label} 변경`}
                    />
                    {label}
                  </Label>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    현재: 켜짐 {stats.on} · 꺼짐 {stats.off}
                  </span>
                </div>
                <p className="pl-6 text-xs text-muted-foreground">{desc}</p>
                <div className="flex items-center gap-2 pl-6">
                  <Switch
                    checked={choice === 'on'}
                    disabled={!willChange}
                    onCheckedChange={(v) => setChoice(v ? 'on' : 'off')}
                    aria-label={`${label} 켜기/끄기`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {willChange
                      ? `${choice === 'on' ? '켜기' : '끄기'} — ${impact}개 변경됩니다`
                      : '변경 안 함'}
                  </span>
                </div>
              </div>
            );
          })}

          <BulkFailureList items={failedItems} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={bulkPolicy.isPending || !hasAnyChange(choices)}
          >
            {bulkPolicy.isPending ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
