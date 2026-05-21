'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDigitalAssets, useDeleteDigitalAsset } from '@/lib/services/library';
import { toast } from 'sonner';
import { DigitalAssetCreateDialog } from '../create-dialog';

export function DigitalAssetsTable() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isFetching } = useDigitalAssets({ q: q || undefined, limit: 50 });
  const deleteMutation = useDeleteDigitalAsset();

  const rows = data?.data ?? [];

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 자산을 삭제하시겠습니까?`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('자산이 삭제되었습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Input
          placeholder="자산 이름으로 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          자산 등록
        </Button>
      </div>

      <div className="px-4 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>MIME</TableHead>
              <TableHead>현재 버전</TableHead>
              <TableHead>등록일</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || isFetching ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  등록된 디지털 자산이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell
                    className="font-medium"
                    onClick={() => router.push(`/mall/digital-assets/${row.id}`)}
                  >
                    {row.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.mimeType ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.currentFileVersion ? `v${row.currentFileVersion.version}` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/mall/digital-assets/${row.id}`)}
                    >
                      상세
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => handleDelete(row.id, row.name)}
                      disabled={deleteMutation.isPending}
                    >
                      삭제
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DigitalAssetCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
