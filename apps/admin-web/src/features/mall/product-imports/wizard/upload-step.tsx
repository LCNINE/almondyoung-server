'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { products } from '@/lib/api/domains';
import { FileDown, Upload } from 'lucide-react';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  onFileSelected: (file: File) => void;
}

export function UploadStep({ onFileSelected }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleTemplate() {
    setDownloading(true);
    try {
      const blob = await products.productImport.downloadTemplate();
      downloadBlob(blob, 'product-import-template.xlsx');
      toast.success('템플릿이 다운로드되었습니다.');
    } catch {
      toast.error('템플릿 다운로드 중 오류가 발생했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    onFileSelected(file);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">1. 엑셀 파일 업로드</h3>
        <p className="text-xs text-muted-foreground">
          템플릿(Products/Options 시트)을 받아 작성한 뒤 업로드하세요. 업로드하면
          자동으로 검증됩니다.
        </p>
      </div>

      <Button variant="outline" onClick={handleTemplate} disabled={downloading}>
        <FileDown className="mr-2 h-4 w-4" />
        {downloading ? '다운로드 중...' : '템플릿 다운로드'}
      </Button>

      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 transition-colors hover:border-primary/50 focus:border-primary/50 focus:outline-none"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          클릭하여 엑셀 파일(.xlsx) 선택
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
