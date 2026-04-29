'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { products } from '@/lib/api/domains';
import { Download } from 'lucide-react';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportSection() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleExport() {
    setIsLoading(true);
    try {
      const blob = await products.csv.export();
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(blob, `products-export-${date}.csv`);
      toast.success('CSV 내보내기가 완료되었습니다.');
    } catch {
      toast.error('CSV 내보내기 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">CSV 내보내기</h3>
        <p className="text-xs text-muted-foreground">
          현재 등록된 전체 상품을 CSV 파일로 다운로드합니다.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={handleExport}
        disabled={isLoading}
      >
        <Download className="mr-2 h-4 w-4" />
        {isLoading ? '내보내는 중...' : '전체 상품 내보내기'}
      </Button>
    </div>
  );
}
