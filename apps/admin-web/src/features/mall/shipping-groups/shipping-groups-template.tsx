'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DEFAULT_SHIPPING_GROUP_CODE,
  SHIPPING_FEE_TYPE_LABELS,
  type ShippingFeePolicy,
  type ShippingGroup,
} from '@/lib/api/domains/medusa/shipping-groups';
import {
  useDeleteShippingGroup,
  useShippingGroups,
} from '@/lib/services/medusa-shipping-groups';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AreaTemplateSection } from './components/area-template-section';
import { ShippingGroupFormDialog } from './components/shipping-group-form-dialog';

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

function describeFee(policy: ShippingFeePolicy): string {
  switch (policy.type) {
    case 'free':
      return '무료';
    case 'flat':
      return won(policy.baseFee);
    case 'conditional_free':
      return `${won(policy.baseFee)} · ${won(policy.freeThreshold ?? 0)} 이상 무료`;
    case 'per_quantity':
      return `${won(policy.baseFee)} × 수량`;
    default:
      return '—';
  }
}

function describeAreaExtra(policy: ShippingFeePolicy): string {
  const parts: string[] = [];
  if (policy.jejuExtraFee) parts.push(`제주 +${won(policy.jejuExtraFee)}`);
  if (policy.islandExtraFee)
    parts.push(`도서산간 +${won(policy.islandExtraFee)}`);
  return parts.length ? parts.join(' · ') : '—';
}

export default function ShippingGroupsTemplate() {
  const { data, isLoading } = useShippingGroups();
  const groups = useMemo(() => data ?? [], [data]);
  const deleteMutation = useDeleteShippingGroup();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShippingGroup | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (group: ShippingGroup) => {
    setEditTarget(group);
    setDialogOpen(true);
  };

  const handleDelete = async (group: ShippingGroup) => {
    try {
      await deleteMutation.mutateAsync(group.code);
      toast.success(`'${group.name}' 그룹을 삭제했어요.`);
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? '배송비 그룹 삭제에 실패했어요.';
      toast.error(message);
    }
  };

  return (
    <Container className="px-6">
      <Header
        className="px-0"
        title="배송비 그룹"
        subtitle="같은 그룹 상품은 여러 개를 담아도 배송비가 한 번만 부과됩니다. 상품별 그룹 지정은 상품 상세에서 합니다."
        right={<Button onClick={openCreate}>그룹 추가</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">그룹</TableHead>
            <TableHead className="w-[110px]">코드</TableHead>
            <TableHead className="w-[180px]">배송비 유형</TableHead>
            <TableHead className="w-[230px]">배송비</TableHead>
            <TableHead className="w-[230px]">지역 추가</TableHead>
            <TableHead className="w-[210px]">배송 안내</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-8 text-center text-muted-foreground"
              >
                불러오는 중...
              </TableCell>
            </TableRow>
          )}
          {!isLoading && groups.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-8 text-center text-muted-foreground"
              >
                등록된 배송비 그룹이 없습니다.
              </TableCell>
            </TableRow>
          )}
          {groups.map((group) => {
            const isDefault = group.code === DEFAULT_SHIPPING_GROUP_CODE;
            return (
              <TableRow key={group.code}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {group.name}
                    {isDefault && <Badge variant="secondary">기본</Badge>}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {group.code}
                </TableCell>
                <TableCell>
                  {SHIPPING_FEE_TYPE_LABELS[group.policy.type] ??
                    group.policy.type}
                </TableCell>
                <TableCell>{describeFee(group.policy)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {describeAreaExtra(group.policy)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {`${group.delivery.method} · ${group.delivery.area} · ${group.delivery.leadTimeMinDays}~${group.delivery.leadTimeMaxDays}일`}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(group)}
                  >
                    수정
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(group)}
                      disabled={deleteMutation.isPending}
                    >
                      삭제
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AreaTemplateSection />

      <ShippingGroupFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        group={editTarget}
      />
    </Container>
  );
}
