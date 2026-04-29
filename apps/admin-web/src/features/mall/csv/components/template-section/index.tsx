'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { products } from '@/lib/api/domains';
import { FileDown } from 'lucide-react';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TemplateSection() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleDownload() {
    setIsLoading(true);
    try {
      const blob = await products.csv.getTemplate();
      downloadBlob(blob, 'product-import-template.csv');
      toast.success('템플릿이 다운로드되었습니다.');
    } catch {
      toast.error('템플릿 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">템플릿 다운로드</h3>
        <p className="text-xs text-muted-foreground">
          상품 일괄 등록을 위한 CSV 양식을 다운로드합니다.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={handleDownload}
        disabled={isLoading}
      >
        <FileDown className="mr-2 h-4 w-4" />
        {isLoading ? '다운로드 중...' : '템플릿 다운로드'}
      </Button>
    </div>
  );
}
