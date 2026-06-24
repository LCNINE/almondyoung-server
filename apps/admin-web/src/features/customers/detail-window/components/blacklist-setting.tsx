'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { Shield, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useBlacklistByUserId,
  useCreateBlacklist,
  useDeleteBlacklist,
} from '@/lib/services/blacklists';
import { formatDateTime } from '@/lib/utils/date';

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

/**
 * 회원 블랙리스트 설정 버튼 (상태 인식형).
 * - 미등록: "블랙리스트 설정" → 사유 입력 다이얼로그
 * - 등록됨: "블랙리스트 해제" → 해제 확인 다이얼로그
 */
export function BlacklistSetting({ userId }: { userId: string }) {
  const { data: blacklist, isLoading, refetch } = useBlacklistByUserId(userId);
  const createBlacklist = useCreateBlacklist();
  const deleteBlacklist = useDeleteBlacklist();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const isBlacklisted = !!blacklist && !blacklist.deletedAt;

  const handleAdd = async () => {
    if (!reason.trim()) return;
    try {
      await createBlacklist.mutateAsync({
        userId,
        reason: reason.trim(),
        internalNote: internalNote.trim() || undefined,
      });
      toast.success('블랙리스트에 추가되었습니다.');
      setOpen(false);
      setReason('');
      setInternalNote('');
      refetch();
    } catch (error) {
      toast.error(errMessage(error, '블랙리스트 추가에 실패했습니다.'));
    }
  };

  const handleRemove = async () => {
    try {
      await deleteBlacklist.mutateAsync(userId);
      toast.success('블랙리스트에서 해제되었습니다.');
      setOpen(false);
      refetch();
    } catch (error) {
      toast.error(errMessage(error, '블랙리스트 해제에 실패했습니다.'));
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={isBlacklisted ? 'destructive' : 'outline'}
        disabled={isLoading}
        onClick={() => setOpen(true)}
      >
        {isBlacklisted ? (
          <ShieldOff className="mr-1 h-4 w-4" />
        ) : (
          <Shield className="mr-1 h-4 w-4" />
        )}
        {isBlacklisted ? '블랙리스트 해제' : '블랙리스트 설정'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {isBlacklisted ? (
            <>
              <DialogHeader>
                <DialogTitle>블랙리스트 해제</DialogTitle>
                <DialogDescription>
                  이 고객을 블랙리스트에서 해제하시겠습니까?
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-2 text-sm text-gray-500">
                <div>사유: {blacklist?.reason ?? '-'}</div>
                <div className="text-xs text-gray-400">
                  등록일: {formatDateTime(blacklist?.createdAt)}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={deleteBlacklist.isPending}
                >
                  {deleteBlacklist.isPending ? '처리중...' : '해제'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>블랙리스트 설정</DialogTitle>
                <DialogDescription>
                  이 고객을 블랙리스트에 추가합니다. 사유를 입력해주세요.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    사유 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="블랙리스트 사유를 입력하세요"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    내부 메모 (선택)
                  </label>
                  <Textarea
                    placeholder="관리자만 보이는 메모"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleAdd}
                  disabled={!reason.trim() || createBlacklist.isPending}
                >
                  {createBlacklist.isPending ? '처리중...' : '추가'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
