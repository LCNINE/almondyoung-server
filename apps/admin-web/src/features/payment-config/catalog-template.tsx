'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  usePaymentMethodCatalog,
  useUpdatePaymentMethodCatalog,
} from '@/lib/services/wallet';
import { useMemo } from 'react';
import { toast } from 'sonner';

export default function PaymentMethodCatalogTemplate() {
  const { data, isLoading } = usePaymentMethodCatalog();
  const catalog = useMemo(() => data ?? [], [data]);
  const updateMutation = useUpdatePaymentMethodCatalog();

  const handleToggle = async (code: string, next: boolean) => {
    try {
      await updateMutation.mutateAsync({ code, payload: { isEnabled: next } });
      toast.success(
        `${code} 결제수단을 ${next ? '활성화' : '비활성화'}했어요.`
      );
    } catch {
      toast.error('변경에 실패했어요.');
    }
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="결제수단 관리"
        subtitle="시스템 전체에서 사용할 결제수단을 켜고 끕니다. 끄면 모든 리전에서 숨겨집니다. 리전별 노출은 '리전·결제수단 관리'에서 설정합니다."
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>코드</TableHead>
            <TableHead>이름</TableHead>
            <TableHead>설명</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="w-[100px] text-right">
              글로벌 활성화
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-muted-foreground"
              >
                불러오는 중...
              </TableCell>
            </TableRow>
          )}
          {!isLoading && catalog.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-muted-foreground"
              >
                등록된 결제수단이 없습니다.
              </TableCell>
            </TableRow>
          )}
          {catalog.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-sm">{c.code}</TableCell>
              <TableCell>{c.displayName}</TableCell>
              <TableCell className="text-muted-foreground">
                {c.description ?? '-'}
              </TableCell>
              <TableCell>
                <Badge variant={c.isEnabled ? 'default' : 'secondary'}>
                  {c.isEnabled ? '활성' : '비활성'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Switch
                  checked={c.isEnabled}
                  onCheckedChange={(v) => handleToggle(c.code, v)}
                  disabled={updateMutation.isPending}
                  aria-label={`${c.displayName} 글로벌 활성화`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Container>
  );
}
