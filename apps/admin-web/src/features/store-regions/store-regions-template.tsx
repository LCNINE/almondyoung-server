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
import type { MedusaRegion } from '@/lib/api/domains/medusa/regions';
import { useMedusaRegions } from '@/lib/services/medusa-regions';
import { useMemo, useState } from 'react';
import { RegionFormDialog } from './components/region-form-dialog';

export default function StoreRegionsTemplate() {
  const { data, isLoading } = useMedusaRegions({ limit: 100 });
  const regions = useMemo(() => data?.regions ?? [], [data]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MedusaRegion | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (region: MedusaRegion) => {
    setEditTarget(region);
    setDialogOpen(true);
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="리전 설정 (Medusa)"
        subtitle="스토어의 통화·국가·세금 설정입니다. 결제수단 가용성은 '리전·결제수단 관리'에서 별도로 설정합니다."
        right={<Button onClick={openCreate}>리전 추가</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>통화</TableHead>
            <TableHead>국가</TableHead>
            <TableHead>자동 세금</TableHead>
            <TableHead>세금 포함</TableHead>
            <TableHead className="w-[80px] text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                불러오는 중...
              </TableCell>
            </TableRow>
          )}
          {!isLoading && regions.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                등록된 리전이 없습니다.
              </TableCell>
            </TableRow>
          )}
          {regions.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="font-mono text-sm uppercase">
                {r.currency_code}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(r.countries ?? []).map((c) => (
                    <Badge
                      key={c.iso_2}
                      variant="secondary"
                      className="font-mono uppercase"
                    >
                      {c.iso_2}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={r.automatic_taxes ? 'default' : 'outline'}>
                  {r.automatic_taxes ? 'ON' : 'OFF'}
                </Badge>
              </TableCell>
              <TableCell>
                {r.is_tax_inclusive === undefined ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Badge variant={r.is_tax_inclusive ? 'default' : 'outline'}>
                    {r.is_tax_inclusive ? '포함' : '별도'}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  수정
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <RegionFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        region={editTarget}
      />
    </Container>
  );
}
