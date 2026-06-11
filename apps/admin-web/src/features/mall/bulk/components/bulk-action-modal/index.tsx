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
import { toast } from 'sonner';
import {
  useBulkUpdateMasters,
  useBulkDeleteMasters,
  useBulkRestoreMasters,
} from '@/lib/services/products';

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
  onSuccess: () => void;
}

export function BulkActionModal({
  open,
  onOpenChange,
  action,
  selectedIds,
  onSuccess,
}: Props) {
  const [status, setStatus] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [brand, setBrand] = useState('');

  const bulkUpdate = useBulkUpdateMasters();
  const bulkDelete = useBulkDeleteMasters();
  const bulkRestore = useBulkRestoreMasters();

  const isPending =
    bulkUpdate.isPending || bulkDelete.isPending || bulkRestore.isPending;

  function getTitle() {
    switch (action) {
      case 'status': return '판매 상태 일괄 변경';
      case 'approvalStatus': return '승인 상태 일괄 변경';
      case 'price': return '판매가 일괄 변경';
      case 'brand': return '브랜드 일괄 변경';
      case 'delete': return '상품 일괄 삭제';
      case 'restore': return '상품 일괄 복원';
      default: return '';
    }
  }

  async function handleConfirm() {
    const count = selectedIds.length;
    try {
      if (action === 'delete') {
        await bulkDelete.mutateAsync({ productIds: selectedIds });
        toast.success(`${count}개 상품이 삭제되었습니다.`);
      } else if (action === 'restore') {
        await bulkRestore.mutateAsync({ productIds: selectedIds });
        toast.success(`${count}개 상품이 복원되었습니다.`);
      } else {
        await bulkUpdate.mutateAsync({
          productIds: selectedIds,
          ...(action === 'status' && status ? { status: status as 'active' | 'inactive' } : {}),
          ...(action === 'approvalStatus' && approvalStatus
            ? { approvalStatus: approvalStatus as 'draft' | 'pending' | 'approved' | 'rejected' }
            : {}),
          ...(action === 'price' && basePrice ? { basePrice: Number(basePrice) } : {}),
          ...(action === 'brand' && brand ? { brand } : {}),
        });
        toast.success(`${count}개 상품이 수정되었습니다.`);
      }
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
                  {/* 일괄 변경은 판매중단만 지원 — 재공개(inactive→active)는 가격/variant 검증이
                      필요해서 상품 상세의 공개 버튼으로만 가능하다. */}
                  <SelectItem value="inactive">판매중단</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                판매중단된 상품을 다시 판매하려면 상품 상세 페이지에서 공개 처리해 주세요.
              </p>
            </div>
          )}

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
            <p className="text-sm text-destructive">
              이 작업은 되돌릴 수 있습니다.
            </p>
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
