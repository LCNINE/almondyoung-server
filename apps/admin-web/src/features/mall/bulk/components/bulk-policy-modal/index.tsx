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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TriangleAlert } from 'lucide-react';
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
  SHIPPING_GROUP_DEFAULT,
  SHIPPING_GROUP_UNCHANGED,
  type PolicyChoices,
} from './build-policy-patch';
import { FormSelect } from '@/components/common/form';
import { DEFAULT_SHIPPING_GROUP_CODE } from '@/lib/api/domains/medusa/shipping-groups';
import { useShippingGroups } from '@/lib/services/medusa-shipping-groups';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedItems: SelectedProductSnapshot[];
  /**
   * 선택이 지금 화면의 필터와 다른 조건에서 담긴 것이면 그 경고 문구.
   * BulkActionModal 과 같은 이유로 여기서도 보여준다 — 아래 "현재: 켜짐 n · 꺼짐 n"
   * 집계는 그 선택을 근거로 세므로, 선택 자체가 낡았다면 그 수도 낡았다.
   * 막지는 않는다(경고만).
   */
  staleWarning?: string | null;
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
  staleWarning,
  onSuccess,
}: Props) {
  const [choices, setChoices] = useState<PolicyChoices>(INITIAL);
  const [shippingGroupChoice, setShippingGroupChoice] = useState<string>(
    SHIPPING_GROUP_UNCHANGED
  );
  const { data: shippingGroups } = useShippingGroups();
  const shippingGroupOptions = [
    { value: SHIPPING_GROUP_UNCHANGED, label: '변경 안 함' },
    { value: SHIPPING_GROUP_DEFAULT, label: '기본 설정 사용' },
    ...(shippingGroups ?? [])
      .filter((group) => group.code !== DEFAULT_SHIPPING_GROUP_CODE)
      .map((group) => ({ value: group.code, label: group.name })),
  ];
  const [failedItems, setFailedItems] = useState<BulkUpdateFailureDto[]>([]);
  const bulkPolicy = useBulkUpdatePolicy();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setChoices(INITIAL);
      setShippingGroupChoice(SHIPPING_GROUP_UNCHANGED);
      setFailedItems([]);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    const patch = buildPolicyPatch(choices, shippingGroupChoice);
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
          {staleWarning && (
            <Alert variant="destructive" className="border-destructive">
              <TriangleAlert />
              <AlertTitle>필터가 바뀐 뒤에도 남은 선택입니다</AlertTitle>
              <AlertDescription>
                {staleWarning} 아래 건수를 꼭 확인하세요.
              </AlertDescription>
            </Alert>
          )}

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

          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Label htmlFor="bulk-policy-shipping-group">배송비 그룹</Label>
            <p className="text-xs text-muted-foreground">
              같은 그룹 상품끼리는 배송비가 한 번만 부과됩니다. 디지털 상품에는
              적용되지 않습니다.
            </p>
            <FormSelect
              value={shippingGroupChoice}
              onValueChange={setShippingGroupChoice}
              options={shippingGroupOptions}
            />
          </div>

          <BulkFailureList items={failedItems} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              bulkPolicy.isPending ||
              !hasAnyChange(choices, shippingGroupChoice)
            }
          >
            {bulkPolicy.isPending ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
