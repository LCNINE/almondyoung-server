'use client';

import {
  useDeleteSupplierRule,
  useReplenishmentSupplierRules,
  useUpsertSupplierRule,
} from '@/lib/services/inventory';
import {
  LeadTimeRulesTable,
  type LeadTimeRuleRow,
} from '../lead-time-rules-table';

export function SuppliersTab() {
  const { data, isLoading } = useReplenishmentSupplierRules();
  const upsert = useUpsertSupplierRule();
  const remove = useDeleteSupplierRule();

  if (isLoading || !data)
    return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const rows: Array<LeadTimeRuleRow<string>> = data.items.map((row) => ({
    key: row.supplierId,
    id: row.supplierId,
    label: row.supplierName,
    name: row.supplierName,
    rule: row.rule,
    observation: row.observation,
  }));

  return (
    <LeadTimeRulesTable
      description="L1 = 공급사 → 출발 창고 입고 리드타임. 관측이 최소 건수 이상 쌓이면 관측이 규칙보다 우선합니다. 규칙이 없으면 전역 기본을 쓰고 제안에 「기본 리드타임」 플래그가 붙습니다. 저장 즉시 제안에 반영됩니다."
      subjectHeader="공급사"
      coverHeader="커버 (일)"
      rows={rows}
      emptyMessage="공급사가 없습니다."
      isSaving={upsert.isPending}
      isDeleting={remove.isPending}
      onSave={(supplierId, dto) => upsert.mutateAsync({ supplierId, dto })}
      onDelete={(supplierId) => remove.mutateAsync(supplierId)}
      deleteSuccessSuffix="전역 발주 기본으로 돌아갑니다."
    />
  );
}
