'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { useDebounced } from '@/hooks/use-debounced';
import type {
  OverrideMode,
  SkuOverrideRowDto,
} from '@/lib/types/dto/inventory';
import {
  useDeleteSkuOverride,
  useReplenishmentSkuOverrides,
  useSkuSearch,
  useUpsertSkuOverride,
} from '@/lib/services/inventory';
import {
  EMPTY_SKU_OVERRIDE_DRAFT,
  REFLECTION_LABELS,
  skuOverrideDraftFrom,
  skuOverridePayloadFrom,
  type SkuOverrideDraft,
} from '../../../rules-model';
import { runWithToast } from '../../save-with-toast';

/**
 * 모듈 스코프에 둔다 — `SkuOverridesTab` 렌더 본문 안에서 선언하면 같은 표의 Input 에
 * 한 글자 칠 때마다 모든 Select 가 새 컴포넌트 타입이 되어 재마운트되고, 포커스와
 * 열려 있던 드롭다운이 사라진다.
 */
function ModeSelect({
  value,
  onChange,
}: {
  value: OverrideMode;
  onChange: (next: OverrideMode) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === 'excluded' ? 'excluded' : 'auto')}
    >
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">계산</SelectItem>
        <SelectItem value="excluded">제외</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** 같은 이유로 모듈 스코프. 예외 한 건의 입력 다섯 칸. */
function OverrideDraftFields({
  draft,
  onChange,
}: {
  draft: SkuOverrideDraft;
  onChange: (patch: Partial<SkuOverrideDraft>) => void;
}) {
  return (
    <>
      <ModeSelect value={draft.mode} onChange={(mode) => onChange({ mode })} />
      <Input
        className="w-36"
        placeholder="제외 종료일 YYYY-MM-DD"
        value={draft.excludedUntil}
        onChange={(e) => onChange({ excludedUntil: e.target.value })}
      />
      <Input
        className="w-28"
        placeholder="안전재고"
        value={draft.safetyStock}
        onChange={(e) => onChange({ safetyStock: e.target.value })}
      />
      <Input
        className="w-24"
        placeholder="α"
        value={draft.alpha}
        onChange={(e) => onChange({ alpha: e.target.value })}
      />
      <Input
        className="w-48"
        placeholder="메모"
        value={draft.memo}
        onChange={(e) => onChange({ memo: e.target.value })}
      />
    </>
  );
}

export function SkuOverridesTab() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 350);
  const { data, isLoading } = useReplenishmentSkuOverrides(debouncedQ);
  const upsert = useUpsertSkuOverride();
  const remove = useDeleteSkuOverride();
  const [drafts, setDrafts] = useState<Record<string, SkuOverrideDraft>>({});

  // 새 예외: SKU 검색 → 선택 → 입력
  const [pick, setPick] = useState('');
  const debouncedPick = useDebounced(pick, 350);
  const { data: candidates } = useSkuSearch(debouncedPick, 1, 20);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(
    null
  );
  const [newDraft, setNewDraft] = useState<SkuOverrideDraft>(
    EMPTY_SKU_OVERRIDE_DRAFT
  );

  const draftOf = (row: SkuOverrideRowDto): SkuOverrideDraft =>
    drafts[row.skuId] ?? skuOverrideDraftFrom(row);

  const patchDraft = (
    skuId: string,
    current: SkuOverrideDraft,
    patch: Partial<SkuOverrideDraft>
  ) => setDrafts((prev) => ({ ...prev, [skuId]: { ...current, ...patch } }));

  /**
   * 드래프트를 버려 서버 값으로 다시 그린다. **삭제에만** 쓴다 — 저장 직후에 버리면
   * 무효화 재조회 전 한 프레임 동안 옛 값이 보여 저장이 날아간 것처럼 읽힌다.
   */
  const clearDraft = (skuId: string) =>
    setDrafts((prev) => {
      if (prev[skuId] === undefined) return prev;
      const next = { ...prev };
      delete next[skuId];
      return next;
    });

  const handleSave = async (row: SkuOverrideRowDto) => {
    const { payload, error } = skuOverridePayloadFrom(draftOf(row));
    if (payload === null) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    await runWithToast({
      run: () => upsert.mutateAsync({ skuId: row.skuId, dto: payload }),
      success: `${row.skuName} 예외를 저장했습니다.`,
      failure: '저장에 실패했습니다.',
    });
  };

  const handleDelete = async (row: SkuOverrideRowDto) => {
    await runWithToast({
      run: () => remove.mutateAsync(row.skuId),
      success: `${row.skuName} 예외를 지웠습니다.`,
      failure: '삭제에 실패했습니다.',
      // 다른 탭과 같게 드래프트도 버린다 — 안 버리면 지운 규칙이 화면에 그대로 남아
      // 같은 SKU 의 규칙이 둘로 보인다.
      onSuccess: () => clearDraft(row.skuId),
    });
  };

  const handleAdd = async (target: { id: string; label: string }) => {
    const { payload, error } = skuOverridePayloadFrom(newDraft);
    if (payload === null) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    await runWithToast({
      run: () => upsert.mutateAsync({ skuId: target.id, dto: payload }),
      success: `${target.label} 예외를 저장했습니다.`,
      failure: '저장에 실패했습니다.',
      // 성공했을 때만 비운다 — 실패해도 지우면 사람이 방금 친 값을 전부 잃는다.
      onSuccess: () => {
        setPicked(null);
        setPick('');
        setNewDraft(EMPTY_SKU_OVERRIDE_DRAFT);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">SKU 예외</h3>
        <Badge variant="secondary">{REFLECTION_LABELS.immediate}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        「제외」는 제안 목록에서 빠집니다(종료일이 지나면 자동으로 계산으로
        돌아옵니다). 안전재고를 넣으면 통계 계산 대신 그 값을 씁니다. α 는 등급
        α 를 덮습니다.
      </p>

      <div className="rounded border p-3">
        <p className="mb-2 text-sm font-semibold">새 예외</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-64"
            placeholder="SKU 코드 · 이름 검색"
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
              setPicked(null);
            }}
          />
          {picked === null &&
            (candidates?.items ?? []).slice(0, 8).map((sku) => (
              <Button
                key={sku.id}
                size="sm"
                variant="outline"
                onClick={() =>
                  setPicked({
                    id: sku.id,
                    label: `${sku.name} (${sku.code})`,
                  })
                }
              >
                {sku.name} ({sku.code})
              </Button>
            ))}
          {picked !== null && <Badge>{picked.label}</Badge>}
        </div>
        {picked !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <OverrideDraftFields
              draft={newDraft}
              onChange={(patch) => setNewDraft({ ...newDraft, ...patch })}
            />
            <Button
              size="sm"
              disabled={upsert.isPending}
              onClick={() => void handleAdd(picked)}
            >
              추가
            </Button>
          </div>
        )}
      </div>

      <Input
        className="w-64"
        placeholder="예외 목록 검색 (코드 · 이름)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">로딩 중...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>예외</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-sm text-muted-foreground"
                >
                  예외가 없습니다.
                </TableCell>
              </TableRow>
            )}
            {data.items.map((row) => {
              const draft = draftOf(row);
              return (
                <TableRow key={row.skuId}>
                  <TableCell>
                    <div className="font-medium">{row.skuName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.skuCode}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <OverrideDraftFields
                        draft={draft}
                        onChange={(patch) =>
                          patchDraft(row.skuId, draft, patch)
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      size="sm"
                      onClick={() => void handleSave(row)}
                      disabled={upsert.isPending}
                    >
                      저장
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDelete(row)}
                      disabled={remove.isPending}
                    >
                      지우기
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
