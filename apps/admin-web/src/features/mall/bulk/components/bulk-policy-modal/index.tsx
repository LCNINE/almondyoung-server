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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
    desc: '체크 시 주문 단계에서 개인통관고유부호 입력이 필수가 됩니다.',
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
            변경할 항목만 켜기/끄기를 선택하세요.
          </p>

          {ROWS.map(({ flag, label, desc }) => {
            const stats = flagStats(selectedItems, flag);
            const choice = choices[flag];
            const impact = flagImpact(stats, choice);
            return (
              <div key={flag} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>{label}</Label>
                  <span className="text-xs text-muted-foreground">
                    현재: 켜짐 {stats.on} · 꺼짐 {stats.off}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{desc}</p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={choice}
                  onValueChange={(v) =>
                    v &&
                    setChoices((prev) => ({
                      ...prev,
                      [flag]: v as PolicyChoice,
                    }))
                  }
                  className="w-full"
                >
                  <ToggleGroupItem value="unchanged">
                    변경 안 함
                  </ToggleGroupItem>
                  <ToggleGroupItem value="on">켜기</ToggleGroupItem>
                  <ToggleGroupItem value="off">끄기</ToggleGroupItem>
                </ToggleGroup>
                {choice !== 'unchanged' && (
                  <p className="text-xs text-muted-foreground">
                    → {choice === 'on' ? '켜기' : '끄기'} 선택 시 {impact}개
                    변경됩니다
                  </p>
                )}
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
