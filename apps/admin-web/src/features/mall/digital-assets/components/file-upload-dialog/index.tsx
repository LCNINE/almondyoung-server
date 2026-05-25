'use client';

import { useState, type ChangeEvent } from 'react';
import { AlertCircle, FileUp } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  DIGITAL_ASSET_FILE_CONTEXT_ID,
  uploadFileToFileService,
  type FileUploadResponse,
} from '@/lib/api/domains/files/upload.client';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (upload: FileUploadResponse, file: File) => void;
};

export function DigitalAssetFileUploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    setIsUploading(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('업로드할 파일을 선택해 주세요.');
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const upload = await uploadFileToFileService(file, {
        contextId: DIGITAL_ASSET_FILE_CONTEXT_ID,
        isPublic: false,
      });
      onUploaded(upload, file);
      toast.success('파일이 업로드되었습니다.', { description: upload.id });
      handleOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '파일 업로드에 실패했습니다.';
      setError(message);
      toast.error('파일 업로드 실패', { description: message });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>디지털 자산 파일 업로드</DialogTitle>
          <DialogDescription>
            file-service 의 digital-asset-file context 로 비공개 파일을
            업로드합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="digital-asset-file">파일</Label>
            <Input
              id="digital-asset-file"
              type="file"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </div>

          {file && (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
              <div className="font-medium">{file.name}</div>
              <div className="mt-1 text-muted-foreground">
                {file.type || 'unknown'} ·{' '}
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>업로드할 수 없습니다</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isUploading}
          >
            취소
          </Button>
          <Button onClick={handleUpload} disabled={!file || isUploading}>
            <FileUp data-icon="inline-start" />
            {isUploading ? '업로드 중...' : '업로드'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
