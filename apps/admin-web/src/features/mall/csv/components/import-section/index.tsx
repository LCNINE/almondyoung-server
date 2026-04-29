'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useCsvBulkImport } from '@/lib/services/products';
import type { CsvImportResultDto } from '@/lib/types/dto/products';
import { Upload } from 'lucide-react';

interface Props {
  userId: string;
}

export function ImportSection({ userId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvImportResultDto | null>(null);
  const { mutateAsync, isPending } = useCsvBulkImport();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const res = await mutateAsync({ file, userId });
      setResult(res);
      if (res.failed === 0) {
        toast.success(`${res.imported}개 상품이 가져오기 완료되었습니다.`);
      } else {
        toast.warning(
          `${res.imported}개 성공, ${res.failed}개 실패했습니다.`
        );
      }
    } catch {
      toast.error('CSV 가져오기 중 오류가 발생했습니다.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">CSV 가져오기</h3>
        <p className="text-xs text-muted-foreground">
          템플릿 형식에 맞는 CSV 파일을 업로드하면 상품이 일괄 등록됩니다.
        </p>
      </div>

      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 transition-colors hover:border-primary/50"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          클릭하여 CSV 파일 선택
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
          disabled={isPending}
        />
        {isPending && (
          <p className="text-sm font-medium text-primary">처리 중...</p>
        )}
      </div>

      {result && (
        <div className="rounded-lg border p-4 text-sm">
          <div className="mb-2 flex gap-6">
            <span>
              성공:{' '}
              <strong className="text-green-600">{result.imported}개</strong>
            </span>
            <span>
              실패:{' '}
              <strong className="text-destructive">{result.failed}개</strong>
            </span>
          </div>
          {result.errors.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-xs text-destructive">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
