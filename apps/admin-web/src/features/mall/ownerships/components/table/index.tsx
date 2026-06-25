'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useAdminOwnerships,
  useReactivateOwnership,
  useRevokeOwnership,
} from '@/lib/services/library';
import type { AdminOwnershipStatus } from '@/lib/types/dto/library';
import { toast } from 'sonner';
import { OwnershipGrantDialog } from '../grant-dialog';

const STATUS_OPTIONS: { value: AdminOwnershipStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'revoked', label: '회수됨' },
];

export function OwnershipsTable() {
  const [customerId, setCustomerId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [salesOrderId, setSalesOrderId] = useState('');
  const [status, setStatus] = useState<AdminOwnershipStatus>('all');
  const [grantOpen, setGrantOpen] = useState(false);

  const { data, isLoading, isFetching } = useAdminOwnerships({
    customerId: customerId || undefined,
    assetId: assetId || undefined,
    salesOrderId: salesOrderId || undefined,
    status,
    take: 50,
  });
  const revokeMutation = useRevokeOwnership();
  const reactivateMutation = useReactivateOwnership();

  const rows = data?.data ?? [];

  const handleRevoke = async (id: string) => {
    const reason = prompt('회수 사유 (선택)') ?? undefined;
    try {
      await revokeMutation.mutateAsync({ id, reason });
      toast.success('사용권을 회수했습니다.');
    } catch {
      toast.error('회수에 실패했습니다.');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await reactivateMutation.mutateAsync(id);
      toast.success('사용권을 재활성화했습니다.');
    } catch {
      toast.error('재활성화에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
        <Input
          placeholder="고객 ID"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="max-w-[220px]"
        />
        <Input
          placeholder="자산 ID"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className="max-w-[220px]"
        />
        <Input
          placeholder="주문 ID"
          value={salesOrderId}
          onChange={(e) => setSalesOrderId(e.target.value)}
          className="max-w-[220px]"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as AdminOwnershipStatus)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setGrantOpen(true)}>
          수동 부여
        </Button>
      </div>

      <div className="px-4 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>자산</TableHead>
              <TableHead>고객 ID</TableHead>
              <TableHead>주문 ID</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>부여일</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || isFetching ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  사용권이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const revoked = !!row.revokedAt;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.asset.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.customerId}</TableCell>
                    <TableCell className="font-mono text-xs">{row.salesOrderId}</TableCell>
                    <TableCell className="text-xs">
                      {revoked ? (
                        <span className="text-destructive">회수됨</span>
                      ) : row.exercisedAt ? (
                        <span className="text-muted-foreground">사용됨</span>
                      ) : (
                        <span className="text-emerald-600">미사용</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.grantedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {revoked ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleReactivate(row.id)}
                          disabled={reactivateMutation.isPending}
                        >
                          재활성화
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleRevoke(row.id)}
                          disabled={revokeMutation.isPending}
                        >
                          회수
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <OwnershipGrantDialog open={grantOpen} onOpenChange={setGrantOpen} />
    </>
  );
}
