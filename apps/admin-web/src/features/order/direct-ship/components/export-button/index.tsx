'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useExportDirectShipFile } from '@/lib/services/orders';

interface Props {
  companyName: string;
}

export function ExportButton({ companyName }: Props) {
  const exportFile = useExportDirectShipFile();

  const handleExport = async () => {
    const blob = await exportFile.mutateAsync(companyName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${companyName}_직배송_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={exportFile.isPending}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      CSV 내보내기
    </Button>
  );
}
