'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useBlacklistByUserId,
  useCreateBlacklist,
  useDeleteBlacklist,
} from '@/lib/services/blacklists';
import { useOptionalAdminUser } from '@/lib/services/users/queries';
import { formatDateTime } from '@/lib/utils/date';
import { AlertCircle, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AxiosError } from 'axios';

function BlacklistAddDialog({
  userId,
  onSuccess,
}: {
  userId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const createBlacklist = useCreateBlacklist();

  const handleSubmit = async () => {
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
      onSuccess();
    } catch (error) {
      const message =
        error instanceof AxiosError
          ? error.response?.data?.message || '블랙리스트 추가에 실패했습니다.'
          : '블랙리스트 추가에 실패했습니다.';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Shield className="mr-1 h-4 w-4" />
          블랙리스트 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>블랙리스트 추가</DialogTitle>
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
            <label className="text-sm font-medium">내부 메모 (선택)</label>
            <Textarea
              placeholder="느낌적인 느낌"
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
            onClick={handleSubmit}
            disabled={!reason.trim() || createBlacklist.isPending}
          >
            {createBlacklist.isPending ? '처리중...' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlacklistRemoveDialog({
  userId,
  onSuccess,
}: {
  userId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const deleteBlacklist = useDeleteBlacklist();

  const handleDelete = async () => {
    try {
      await deleteBlacklist.mutateAsync(userId);
      toast.success('블랙리스트에서 해제되었습니다.');
      setOpen(false);
      onSuccess();
    } catch (error) {
      const message =
        error instanceof AxiosError
          ? error.response?.data?.message || '블랙리스트 해제에 실패했습니다.'
          : '블랙리스트 해제에 실패했습니다.';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="mr-1 h-4 w-4" />
          해제
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>블랙리스트 해제</DialogTitle>
          <DialogDescription>
            이 고객을 블랙리스트에서 해제하시겠습니까?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteBlacklist.isPending}
          >
            {deleteBlacklist.isPending ? '처리중...' : '해제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerBlacklistContent({ userId }: { userId: string }) {
  const { data: blacklist, isLoading, error, refetch } = useBlacklistByUserId(userId);
  const { data: createdByAdmin } = useOptionalAdminUser(blacklist?.createdBy);
  const { data: deletedByAdmin } = useOptionalAdminUser(blacklist?.deletedBy);

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }

  const isBlacklisted = !!blacklist && !blacklist.deletedAt;

  const getAdminName = (admin: typeof createdByAdmin) => {
    if (!admin) return '-';
    return admin.nickname || admin.username || admin.email || '-';
  };

  if (error || !blacklist) {
    return (
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <AlertCircle className="h-4 w-4" />
          <span>블랙리스트에 등록되지 않은 고객입니다.</span>
        </div>
        <BlacklistAddDialog userId={userId} onSuccess={() => refetch()} />
      </div>
    );
  }

  if (!isBlacklisted) {
    return (
      <div className="p-4">
        <div className="mb-4 space-y-1 text-sm text-gray-500">
          <div>이전에 블랙리스트였으나 해제되었습니다.</div>
          <div className="text-xs text-gray-400">사유: {blacklist.reason}</div>
          <div className="text-xs text-gray-400">
            해제일: {formatDateTime(blacklist.deletedAt)} (
            {getAdminName(deletedByAdmin)})
          </div>
        </div>
        <BlacklistAddDialog userId={userId} onSuccess={() => refetch()} />
      </div>
    );
  }

  const rows: { key: string; value: string | null }[] = [
    { key: '사유', value: blacklist.reason },
    { key: '내부 메모', value: blacklist.internalNote },
    { key: '등록일', value: formatDateTime(blacklist.createdAt) },
    { key: '등록자', value: getAdminName(createdByAdmin) },
  ];

  return (
    <div>
      <div className="border-b border-red-200 bg-red-50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600">
            <Shield className="h-4 w-4" />
            <span className="text-sm font-medium">블랙리스트 등록됨</span>
          </div>
          <BlacklistRemoveDialog userId={userId} onSuccess={() => refetch()} />
        </div>
      </div>
      {rows.map(({ key, value }) => (
        <div key={key} className="grid grid-cols-2 p-3">
          <div className="text-sm font-medium text-gray-500">{key}</div>
          <div className="text-sm">{value ?? '-'}</div>
        </div>
      ))}
    </div>
  );
}

export function CustomerBlacklist({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="블랙리스트" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <CustomerBlacklistContent userId={userId} />
      </Suspense>
    </Container>
  );
}
