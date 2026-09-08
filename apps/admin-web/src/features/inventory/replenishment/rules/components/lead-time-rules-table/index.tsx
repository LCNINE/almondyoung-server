'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
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
import type {
  LeadTimeObservationDto,
  LeadTimeRuleDto,
  UpsertLeadTimeRuleDto,
} from '@/lib/types/dto/inventory';
import {
  EMPTY_LEAD_TIME_DRAFT,
  formatLeadTimeObservation,
  leadTimeDraftFrom,
  leadTimeRulePayloadFrom,
  type LeadTimeDraft,
} from '../../../rules-model';
import { runWithToast } from '../../save-with-toast';

/**
 * 공급사(L1) 탭과 경로(L2) 탭은 같은 `UpsertLeadTimeRuleDto` 를 같은 6열 표로 편집한다 —
 * 첫 열의 이름과 「새 행」이 있느냐만 다르다. 두 벌로 두면 검증 · 드래프트 · 토스트가
 * 각각 어긋나므로 한 컴포넌트로 둔다(스펙 §8.4).
 */
export type LeadTimeRuleRow<TId> = {
  /** react 키 겸 드래프트 키 */
  key: string;
  /** 저장 · 삭제 호출에 그대로 넘기는 식별자 */
  id: TId;
  /** 첫 열에 그리는 것 */
  label: ReactNode;
  /** 토스트 문구에 쓰는 이름 */
  name: string;
  rule: LeadTimeRuleDto | null;
  observation: LeadTimeObservationDto | null;
};

export type NewLeadTimeRow = {
  /**
   * 드래프트 키. 선택값에서 파생시키면 안 된다 — 고르는 순간 키가 바뀌어 그 전에 친
   * 입력이 사라진다. `NEW_ROUTE_DRAFT_KEY` 같은 고정 합성 키를 쓴다.
   */
  key: string;
  label: ReactNode;
  disabled: boolean;
  onAdd: (payload: UpsertLeadTimeRuleDto) => Promise<unknown>;
  success: string;
};

type Props<TId> = {
  description: string;
  subjectHeader: string;
  coverHeader: string;
  rows: Array<LeadTimeRuleRow<TId>>;
  emptyMessage: string;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (id: TId, payload: UpsertLeadTimeRuleDto) => Promise<unknown>;
  onDelete: (id: TId) => Promise<unknown>;
  deleteSuccessSuffix: string;
  newRow?: NewLeadTimeRow;
};

/** 렌더 본문이 아니라 모듈 스코프에 둔다 — 안에서 선언하면 한 글자마다 입력이 재마운트된다. */
function LeadTimeDraftCells({
  draft,
  onChange,
}: {
  draft: LeadTimeDraft;
  onChange: (patch: Partial<LeadTimeDraft>) => void;
}) {
  return (
    <>
      <TableCell>
        <Input
          className="w-24"
          value={draft.leadTimeDays}
          onChange={(e) => onChange({ leadTimeDays: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          className="w-24"
          placeholder="cv·μ"
          value={draft.leadTimeStdDays}
          onChange={(e) => onChange({ leadTimeStdDays: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          className="w-24"
          value={draft.coverDays}
          onChange={(e) => onChange({ coverDays: e.target.value })}
        />
      </TableCell>
    </>
  );
}

export function LeadTimeRulesTable<TId>({
  description,
  subjectHeader,
  coverHeader,
  rows,
  emptyMessage,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
  deleteSuccessSuffix,
  newRow,
}: Props<TId>) {
  const [drafts, setDrafts] = useState<Record<string, LeadTimeDraft>>({});

  const draftOf = (key: string, rule: LeadTimeRuleDto | null): LeadTimeDraft =>
    drafts[key] ?? leadTimeDraftFrom(rule);

  const patchDraft = (
    key: string,
    current: LeadTimeDraft,
    patch: Partial<LeadTimeDraft>
  ) => setDrafts((prev) => ({ ...prev, [key]: { ...current, ...patch } }));

  /**
   * 드래프트를 버려 서버 값으로 다시 그린다. **삭제와 새 행 추가에만** 쓴다 —
   * 저장 직후에 버리면 무효화 재조회가 돌아오기 전 한 프레임 동안 옛 값(규칙이 없던 행은
   * 빈칸)이 보여 방금 한 저장이 날아간 것처럼 읽힌다. 저장한 드래프트는 저장한 값과
   * 같으므로 그대로 두는 편이 옳다.
   */
  const clearDraft = (key: string) =>
    setDrafts((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const handleSave = async (row: LeadTimeRuleRow<TId>) => {
    const { payload, error } = leadTimeRulePayloadFrom(
      draftOf(row.key, row.rule)
    );
    if (payload === null) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    await runWithToast({
      run: () => onSave(row.id, payload),
      success: `${row.name} 규칙을 저장했습니다.`,
      failure: '저장에 실패했습니다.',
    });
  };

  const handleDelete = async (row: LeadTimeRuleRow<TId>) => {
    await runWithToast({
      run: () => onDelete(row.id),
      success: `${row.name} 규칙을 지웠습니다. ${deleteSuccessSuffix}`,
      failure: '삭제에 실패했습니다.',
      onSuccess: () => clearDraft(row.key),
    });
  };

  const handleAdd = async (target: NewLeadTimeRow) => {
    const { payload, error } = leadTimeRulePayloadFrom(
      drafts[target.key] ?? EMPTY_LEAD_TIME_DRAFT
    );
    if (payload === null) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    await runWithToast({
      run: () => target.onAdd(payload),
      success: target.success,
      failure: '저장에 실패했습니다.',
      onSuccess: () => clearDraft(target.key),
    });
  };

  const newDraft =
    newRow === undefined
      ? EMPTY_LEAD_TIME_DRAFT
      : (drafts[newRow.key] ?? EMPTY_LEAD_TIME_DRAFT);

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{subjectHeader}</TableHead>
            <TableHead>관측 (n · 평균 · σ)</TableHead>
            <TableHead>리드타임 (일)</TableHead>
            <TableHead>σ (일)</TableHead>
            <TableHead>{coverHeader}</TableHead>
            <TableHead className="text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && newRow === undefined && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const draft = draftOf(row.key, row.rule);
            return (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatLeadTimeObservation(row.observation)}
                </TableCell>
                <LeadTimeDraftCells
                  draft={draft}
                  onChange={(patch) => patchDraft(row.key, draft, patch)}
                />
                <TableCell className="space-x-1 text-right">
                  <Button
                    size="sm"
                    onClick={() => void handleSave(row)}
                    disabled={isSaving}
                  >
                    저장
                  </Button>
                  {row.rule !== null && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDelete(row)}
                      disabled={isDeleting}
                    >
                      지우기
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {newRow !== undefined && (
            <TableRow>
              <TableCell>{newRow.label}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                새 규칙
              </TableCell>
              <LeadTimeDraftCells
                draft={newDraft}
                onChange={(patch) => patchDraft(newRow.key, newDraft, patch)}
              />
              <TableCell className="text-right">
                <Button
                  size="sm"
                  disabled={newRow.disabled}
                  onClick={() => void handleAdd(newRow)}
                >
                  추가
                </Button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
