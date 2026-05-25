'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateDigitalAsset } from '@/lib/services/library';
import type { CreateDigitalAssetDto } from '@/lib/types/dto/library';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { DigitalAssetFileUploadDialog } from '../file-upload-dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: CreateDigitalAssetDto = { name: '' };

export function DigitalAssetCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateDigitalAssetDto>(EMPTY);
  const [uploadOpen, setUploadOpen] = useState(false);
  const createMutation = useCreateDigitalAsset();
  const canSubmit = Boolean(form.name?.trim()) && !createMutation.isPending;

  const handleClose = () => {
    setForm(EMPTY);
    setUploadOpen(false);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast.error('이름을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        ...form,
        description: form.description?.trim() || undefined,
        mimeType: form.mimeType?.trim() || undefined,
        thumbnailUrl: form.thumbnailUrl?.trim() || undefined,
        initialFileId: form.initialFileId?.trim() || undefined,
        initialReleaseNote: form.initialReleaseNote?.trim() || undefined,
      });
      toast.success('디지털 자산이 등록되었습니다.');
      handleClose();
    } catch {
      toast.error('등록에 실패했습니다.');
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>디지털 자산 등록</DialogTitle>
            <DialogDescription>
              메타데이터를 등록합니다. 파일은 등록 후 file-service 의 fileId 로
              버전을 추가하거나, 함께 입력할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[calc(90vh-132px)] gap-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-2">
              <Label htmlFor="name">
                이름 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                className="h-11"
                placeholder="예: 시술 동의서 v1"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                className="min-h-[80px]"
                placeholder="운영자 메모"
                value={form.description ?? ''}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="mimeType">MIME 타입</Label>
                <Input
                  id="mimeType"
                  placeholder="application/pdf"
                  value={form.mimeType ?? ''}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, mimeType: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="thumbnailUrl">썸네일 URL</Label>
                <Input
                  id="thumbnailUrl"
                  placeholder="https://..."
                  value={form.thumbnailUrl ?? ''}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, thumbnailUrl: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border bg-muted/20 p-4">
              <h3 className="text-sm font-medium">초기 파일 버전 (선택)</h3>
              <p className="text-xs text-muted-foreground">
                파일을 업로드하면 file-service 파일 ID 가 자동으로 채워집니다.
                이미 업로드된 파일을 연결해야 할 때만 직접 입력하세요.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="initialFileId">file-service 파일 ID</Label>
                <div className="flex gap-2">
                  <Input
                    id="initialFileId"
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={form.initialFileId ?? ''}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, initialFileId: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setUploadOpen(true)}
                  >
                    <FileUp data-icon="inline-start" />
                    업로드
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="initialReleaseNote">릴리즈 노트</Label>
                <Input
                  id="initialReleaseNote"
                  placeholder="v1.0 초기 등록"
                  value={form.initialReleaseNote ?? ''}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      initialReleaseNote: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={handleClose}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DigitalAssetFileUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(upload, file) =>
          setForm((prev) => ({
            ...prev,
            name: prev.name || file.name.replace(/\.[^.]+$/, ''),
            mimeType: prev.mimeType || file.type || undefined,
            initialFileId: upload.id,
          }))
        }
      />
    </>
  );
}
