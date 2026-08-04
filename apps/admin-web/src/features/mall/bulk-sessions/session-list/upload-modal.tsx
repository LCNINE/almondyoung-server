'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUploadBulkSession } from '@/lib/services/products/bulk-session';
import { MAX_UPLOAD_BYTES, parseUploadError } from '../lib/upload-error';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UploadModal({ open, onClose }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const upload = useUploadBulkSession();

  function reset() {
    setFile(null);
    setName('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      onClose();
    }
  }

  function handleSubmit() {
    if (!file) {
      toast.error('업로드할 파일을 선택해 주세요.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.');
      return;
    }
    upload.mutate(
      { file, name: name.trim() || undefined },
      {
        onSuccess: (res) => {
          reset();
          onClose();
          router.push(`/mall/bulk-sessions/${res.sessionId}`);
        },
        onError: (error) => {
          toast.error(parseUploadError(error));
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>양식 업로드</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="bulk-session-file">엑셀 파일</Label>
            <Input
              id="bulk-session-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bulk-session-name">이름 (선택)</Label>
            <Input
              id="bulk-session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="비우면 파일명이 들어갑니다"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={upload.isPending}>
            {upload.isPending ? '업로드 중…' : '업로드'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
