'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useDeleteRouteRule,
  useReplenishmentRouteRules,
  useUpsertRouteRule,
  useWarehouses,
} from '@/lib/services/inventory';
import {
  NEW_ROUTE_DRAFT_KEY,
  ROUTE_ADD_ISSUE_LABELS,
  routeAddIssue,
  routeRuleKey,
} from '../../../rules-model';
import {
  LeadTimeRulesTable,
  type LeadTimeRuleRow,
  type NewLeadTimeRow,
} from '../lead-time-rules-table';

type RouteId = { from: string; to: string };

export function RoutesTab() {
  const { data, isLoading } = useReplenishmentRouteRules();
  const { data: warehouses } = useWarehouses();
  const upsert = useUpsertRouteRule();
  const remove = useDeleteRouteRule();
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');

  if (isLoading || !data)
    return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const rows: Array<LeadTimeRuleRow<RouteId>> = data.items.map((row) => {
    const name = `${row.fromWarehouseName} → ${row.toWarehouseName}`;
    return {
      key: routeRuleKey(row.fromWarehouseId, row.toWarehouseId),
      id: { from: row.fromWarehouseId, to: row.toWarehouseId },
      label: name,
      name,
      rule: row.rule,
      observation: row.observation,
    };
  });

  const options = warehouses ?? [];
  const issue = routeAddIssue({
    from: newFrom,
    to: newTo,
    knownKeys: new Set(rows.map((row) => row.key)),
  });

  const newRow: NewLeadTimeRow = {
    // 창고 선택에서 파생시키지 않는다 — 고르는 순간 키가 바뀌어 이미 친 값이 사라진다.
    key: NEW_ROUTE_DRAFT_KEY,
    label: (
      <div className="flex items-center gap-1">
        <Select value={newFrom} onValueChange={setNewFrom}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="출발 창고" />
          </SelectTrigger>
          <SelectContent>
            {options.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>→</span>
        <Select value={newTo} onValueChange={setNewTo}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="도착 창고" />
          </SelectTrigger>
          <SelectContent>
            {options.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {issue !== null && issue !== 'incomplete' && (
          <span className="text-xs text-destructive">
            {ROUTE_ADD_ISSUE_LABELS[issue]}
          </span>
        )}
      </div>
    ),
    disabled: issue !== null || upsert.isPending,
    onAdd: async (dto) => {
      const result = await upsert.mutateAsync({
        from: newFrom,
        to: newTo,
        dto,
      });
      // 성공한 뒤에만 선택을 비운다 — 실패했으면 고른 창고를 남겨 다시 시도하게 한다.
      setNewFrom('');
      setNewTo('');
      return result;
    },
    success: '새 경로 규칙을 저장했습니다.',
  };

  return (
    <LeadTimeRulesTable
      description="L2 = 출발 창고 → 판매 창고 도착 리드타임. 지시서 선적·수령 관측이 쌓이면 관측이 우선합니다. 목록은 규칙이 있거나 관측이 있는 경로이며, 없는 경로는 아래 행에서 추가합니다. 저장 즉시 제안에 반영됩니다."
      subjectHeader="경로"
      coverHeader="이동 커버 (일)"
      rows={rows}
      emptyMessage="규칙도 관측도 있는 경로가 없습니다."
      isSaving={upsert.isPending}
      isDeleting={remove.isPending}
      onSave={(id, dto) =>
        upsert.mutateAsync({ from: id.from, to: id.to, dto })
      }
      onDelete={(id) => remove.mutateAsync({ from: id.from, to: id.to })}
      deleteSuccessSuffix="전역 이동 기본으로 돌아갑니다."
      newRow={newRow}
    />
  );
}
