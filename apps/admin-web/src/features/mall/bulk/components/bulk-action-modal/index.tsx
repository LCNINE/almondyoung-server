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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  useBulkUpdateMasters,
  useBulkDeleteMasters,
  useBulkRestoreMasters,
} from '@/lib/services/products';
import type { BulkUpdateFailureDto } from '@/lib/types/dto/products';
import { BulkFailureList } from '@/features/mall/bulk/components/bulk-failure-list';
import { SELECTION_PREVIEW_LIMIT } from '@/features/mall/products-list/components/table/products-list-selection-model';
import { ShortId } from '@/components/admin-ui-experimental/common/copy/short-id';

export type BulkActionType =
  | 'status'
  | 'approvalStatus'
  | 'price'
  | 'brand'
  | 'delete'
  | 'restore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkActionType | null;
  selectedIds: string[];
  selectedItems?: { masterId: string; name: string }[];
  /**
   * 선택이 지금 화면의 필터와 다른 조건에서 담긴 것이면 그 경고 문구. 목록 툴바에도
   * 같은 배지가 뜨지만, 최대 5,000건을 지우기 직전의 마지막 관문은 이 모달이다 —
   * 여기서 안 보이면 경고가 필요한 화면에는 끝내 닿지 않는다.
   * 막지는 않는다(경고만) — 이미 내려진 결정이다.
   */
  staleWarning?: string | null;
  onSuccess: () => void;
}

export function BulkActionModal({
  open,
  onOpenChange,
  action,
  selectedIds,
  selectedItems,
  staleWarning,
  onSuccess,
}: Props) {
  const [status, setStatus] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [brand, setBrand] = useState('');
  const [failedItems, setFailedItems] = useState<BulkUpdateFailureDto[]>([]);

  const bulkUpdate = useBulkUpdateMasters();
  const bulkDelete = useBulkDeleteMasters();
  const bulkRestore = useBulkRestoreMasters();

  const isPending =
    bulkUpdate.isPending || bulkDelete.isPending || bulkRestore.isPending;

  // 이 목록은 삭제/복원을 되돌리기 전 마지막 확인 관문이다. 필터 결과 전체 선택으로
  // 수천 건이 담길 수 있으므로 렌더는 상한을 두고, 나머지는 건수로만 알린다.
  const confirmList = selectedItems ?? [];
  const shownItems = confirmList.slice(0, SELECTION_PREVIEW_LIMIT);
  const hiddenItemCount = confirmList.length - shownItems.length;

  function getTitle() {
    switch (action) {
      case 'status':
        return '판매 상태 일괄 변경';
      case 'approvalStatus':
        return '승인 상태 일괄 변경';
      case 'price':
        return '판매가 일괄 변경';
      case 'brand':
        return '브랜드 일괄 변경';
      case 'delete':
        return '상품 일괄 삭제';
      case 'restore':
        return '상품 일괄 복원';
      default:
        return '';
    }
  }

  async function handleConfirm() {
    const count = selectedIds.length;
    setFailedItems([]);
    try {
      if (action === 'delete') {
        await bulkDelete.mutateAsync({ productIds: selectedIds });
        toast.success(`${count}개 상품이 삭제되었습니다.`);
      } else if (action === 'restore') {
        await bulkRestore.mutateAsync({ productIds: selectedIds });
        toast.success(`${count}개 상품이 복원되었습니다.`);
      } else {
        const result = await bulkUpdate.mutateAsync({
          productIds: selectedIds,
          ...(action === 'status' && status
            ? { status: status as 'active' | 'inactive' }
            : {}),
          ...(action === 'approvalStatus' && approvalStatus
            ? {
                approvalStatus: approvalStatus as
                  | 'draft'
                  | 'pending'
                  | 'approved'
                  | 'rejected',
              }
            : {}),
          ...(action === 'price' && basePrice
            ? { basePrice: Number(basePrice) }
            : {}),
          ...(action === 'brand' && brand ? { brand } : {}),
        });

        const failures = result.failed ?? [];
        if (failures.length > 0) {
          // 부분 실패 — 모달을 닫지 않고 실패 목록을 보여준다.
          setFailedItems(failures);
          toast.warning(
            `${result.updated}개 적용, ${failures.length}개 실패했습니다.`
          );
          onSuccess();
          return;
        }

        toast.success(`${count}개 상품이 수정되었습니다.`);
      }
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) setFailedItems([]);
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {staleWarning && (
            <Alert variant="destructive" className="border-destructive">
              <TriangleAlert />
              <AlertTitle>필터가 바뀐 뒤에도 남은 선택입니다</AlertTitle>
              <AlertDescription>
                {staleWarning} 아래 목록과 건수를 꼭 확인하세요.
              </AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-muted-foreground">
            선택된 <strong>{selectedIds.length}개</strong> 상품에 적용됩니다.
          </p>

          {action === 'status' && (
            <div className="space-y-2">
              <Label>판매 상태</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="상태 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">판매 활성화</SelectItem>
                  <SelectItem value="inactive">판매중단</SelectItem>
                </SelectContent>
              </Select>
              {status === 'active' && (
                <p className="text-xs text-muted-foreground">
                  가격·옵션 검증을 통과한 상품만 활성화되며, 실패한 상품은
                  목록으로 표시됩니다.
                </p>
              )}
            </div>
          )}

          <BulkFailureList items={failedItems} />

          {action === 'approvalStatus' && (
            <div className="space-y-2">
              <Label>승인 상태</Label>
              <Select value={approvalStatus} onValueChange={setApprovalStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="승인 상태 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">임시저장</SelectItem>
                  <SelectItem value="pending">승인 대기</SelectItem>
                  <SelectItem value="approved">승인됨</SelectItem>
                  <SelectItem value="rejected">거부됨</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {action === 'price' && (
            <div className="space-y-2">
              <Label>판매가 (원)</Label>
              <Input
                type="number"
                min={0}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          {action === 'brand' && (
            <div className="space-y-2">
              <Label>브랜드명</Label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="브랜드명 입력"
              />
            </div>
          )}

          {(action === 'delete' || action === 'restore') && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                이 작업은 되돌릴 수 있습니다.
              </p>
              {confirmList.length > 0 && (
                <>
                  <ul className="p-2 space-y-1 overflow-y-auto text-xs border rounded-md max-h-40 text-muted-foreground">
                    {shownItems.map((item) => (
                      <li
                        key={item.masterId}
                        className="truncate text-foreground"
                        title={item.name || item.masterId}
                      >
                        {/* 전체 선택으로 담긴 항목은 이름이 비어 있다. 빈 줄만 늘어놓으면
                            무엇을 지우는지 판단할 수 없으므로 id 라도 보여준다. */}
                        {item.name ? (
                          item.name
                        ) : (
                          <ShortId value={item.masterId} />
                        )}
                      </li>
                    ))}
                  </ul>
                  {hiddenItemCount > 0 && (
                    <p className="text-xs text-center text-muted-foreground">
                      이 외 {hiddenItemCount.toLocaleString()}건은 목록에
                      표시하지 않습니다.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending}
            variant={action === 'delete' ? 'destructive' : 'default'}
          >
            {isPending ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
