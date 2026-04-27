'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Save, Trash2, Plus } from 'lucide-react';
import { RuleRow } from './rule-row';
import { DeleteRulesDialog } from '../delete-rules-dialog';
import type {
  PricingRulesResponseDto,
  PricingRuleInput,
  PricingLayer,
  ReplacePricingRulesDto,
} from '@/lib/types/dto/products';
import { toServerScale } from '@/lib/services/products/transformers';

const LAYER_TABS: { value: PricingLayer; label: string }[] = [
  { value: 'base_price', label: '기준가' },
  { value: 'membership_price', label: '멤버십가' },
  { value: 'tiered_price', label: '수량별 가격' },
];

function rulesFromResponse(rules: PricingRulesResponseDto): {
  base: PricingRuleInput[];
  membership: PricingRuleInput[];
  tiered: PricingRuleInput[];
} {
  const mapRule = (r: PricingRulesResponseDto['basePriceRules'][number]): PricingRuleInput => ({
    order: r.order,
    layer: r.layer,
    scopeType: r.scopeType,
    scopeTargetIds: r.scopeTargetIds ?? undefined,
    operationType: r.operationType,
    operationValue: r.operationValue,
    minQuantity: r.minQuantity ?? undefined,
  });
  return {
    base: rules.basePriceRules.map(mapRule),
    membership: rules.membershipPriceRules.map(mapRule),
    tiered: rules.tieredPriceRules.map(mapRule),
  };
}

function makeNewRule(layer: PricingLayer, order: number): PricingRuleInput {
  return {
    order,
    layer,
    scopeType: 'all_variants',
    operationType: layer === 'base_price' ? 'override' : 'offset',
    operationValue: layer === 'base_price' ? 0 : 0,
    minQuantity: layer === 'tiered_price' ? 1 : undefined,
  };
}

interface Props {
  rules: PricingRulesResponseDto | undefined;
  readonly: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (dto: ReplacePricingRulesDto) => void;
  onDelete: () => void;
}

export function RulesEditor({ rules, readonly, isSaving, isDeleting, onSave, onDelete }: Props) {
  const [base, setBase] = useState<PricingRuleInput[]>([]);
  const [membership, setMembership] = useState<PricingRuleInput[]>([]);
  const [tiered, setTiered] = useState<PricingRuleInput[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!rules) return;
    const parsed = rulesFromResponse(rules);
    setBase(parsed.base);
    setMembership(parsed.membership);
    setTiered(parsed.tiered);
  }, [rules]);

  const reorder = (arr: PricingRuleInput[]): PricingRuleInput[] =>
    arr.map((r, i) => ({ ...r, order: i + 1 }));

  const makeMutators = (
    arr: PricingRuleInput[],
    set: (v: PricingRuleInput[]) => void,
    layer: PricingLayer,
  ) => ({
    onChange: (i: number, updated: PricingRuleInput) => {
      const next = [...arr];
      next[i] = updated;
      set(next);
    },
    onMoveUp: (i: number) => {
      if (i === 0) return;
      const next = [...arr];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      set(reorder(next));
    },
    onMoveDown: (i: number) => {
      if (i === arr.length - 1) return;
      const next = [...arr];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      set(reorder(next));
    },
    onRemove: (i: number) => {
      const next = arr.filter((_, idx) => idx !== i);
      set(reorder(next));
    },
    onAdd: () => {
      set(reorder([...arr, makeNewRule(layer, arr.length + 1)]));
    },
  });

  const bm = makeMutators(base, setBase, 'base_price');
  const mm = makeMutators(membership, setMembership, 'membership_price');
  const tm = makeMutators(tiered, setTiered, 'tiered_price');

  const handleSave = () => {
    onSave({ basePriceRules: base, membershipPriceRules: membership, tieredPriceRules: tiered });
  };

  const renderTable = (
    arr: PricingRuleInput[],
    layer: PricingLayer,
    mutators: ReturnType<typeof makeMutators>,
  ) => (
    <div>
      {arr.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">룰이 없습니다.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-center">순서</th>
              <th className="px-3 py-2 text-left">적용 범위</th>
              <th className="px-3 py-2 text-left">연산</th>
              <th className="px-3 py-2 text-left">값</th>
              {layer === 'tiered_price' && <th className="px-3 py-2 text-left">최소 수량</th>}
              <th className="px-3 py-2 text-left">작업</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((rule, i) => (
              <RuleRow
                key={i}
                rule={rule}
                index={i}
                total={arr.length}
                layer={layer}
                readonly={readonly}
                onChange={mutators.onChange}
                onMoveUp={mutators.onMoveUp}
                onMoveDown={mutators.onMoveDown}
                onRemove={mutators.onRemove}
              />
            ))}
          </tbody>
        </table>
      )}
      {!readonly && (
        <div className="mt-2 px-3">
          <Button size="sm" variant="ghost" onClick={mutators.onAdd}>
            <Plus className="mr-1 h-3 w-3" />
            룰 추가
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">가격 룰</span>
        {!readonly && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={isDeleting || isSaving}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              전체 삭제
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving || isDeleting}>
              <Save className="mr-1 h-3 w-3" />
              {isSaving ? '저장 중...' : '저장'}
            </Button>
          </div>
        )}
        {readonly && (
          <span className="text-xs text-muted-foreground">활성 버전은 읽기 전용입니다.</span>
        )}
      </div>

      <Tabs defaultValue="base_price" className="px-4 pb-4">
        <TabsList>
          {LAYER_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="base_price">{renderTable(base, 'base_price', bm)}</TabsContent>
        <TabsContent value="membership_price">
          {renderTable(membership, 'membership_price', mm)}
        </TabsContent>
        <TabsContent value="tiered_price">{renderTable(tiered, 'tiered_price', tm)}</TabsContent>
      </Tabs>

      <DeleteRulesDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
        isPending={isDeleting}
      />
    </div>
  );
}
