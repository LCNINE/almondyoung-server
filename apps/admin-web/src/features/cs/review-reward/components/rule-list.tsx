'use client';

import { useState } from 'react';
import { ReviewRewardRuleDto, UpsertReviewRewardRuleDto } from '@/lib/types/dto/review-reward';
import {
  useCreateReviewRewardRule,
  useDeleteReviewRewardRule,
  useReviewRewardRules,
  useSetReviewRewardRuleActive,
  useUpdateReviewRewardRule,
} from '@/lib/services/review-reward';
import { RuleForm } from './rule-form';
import {
  describeReward,
  emptyRuleForm,
  formatDateTime,
  REVIEW_TYPE_LABELS,
  rewardRuleNotice,
  TRIGGER_LABELS,
} from '../shared';

function toFormValue(rule: ReviewRewardRuleDto): UpsertReviewRewardRuleDto {
  return {
    name: rule.name,
    description: rule.description,
    trigger: rule.trigger,
    active: rule.active,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    conditions: rule.conditions,
    reward: rule.reward,
    limits: rule.limits,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
  };
}

function describeConditions(rule: ReviewRewardRuleDto): string {
  const parts = [REVIEW_TYPE_LABELS[rule.conditions.reviewType]];
  if (rule.conditions.minContentLength > 0) parts.push(`${rule.conditions.minContentLength}자 이상`);
  if (rule.conditions.minMediaCount > 0) parts.push(`사진 ${rule.conditions.minMediaCount}장 이상`);
  if (rule.conditions.minRating !== null) parts.push(`별점 ${rule.conditions.minRating} 이상`);
  if (rule.conditions.everyNthReview !== null) parts.push(`${rule.conditions.everyNthReview}번째마다`);
  if (rule.conditions.best) parts.push(`상위 ${rule.conditions.best.topN}명`);
  return parts.join(' · ');
}

function describeLimits(rule: ReviewRewardRuleDto): string {
  const parts: string[] = [];
  const format = (label: string, spec: ReviewRewardRuleDto['limits']['perUser']) => {
    if (!spec) return;
    const axes = [
      spec.maxCount !== null ? `${spec.maxCount}건` : null,
      spec.maxAmount !== null ? `${spec.maxAmount.toLocaleString('ko-KR')}원` : null,
    ].filter(Boolean);
    if (axes.length) parts.push(`${label} ${axes.join('/')}`);
  };
  format('1인당', rule.limits.perUser);
  format('전체', rule.limits.global);
  return parts.length ? parts.join(' · ') : '한도 없음';
}

export function RuleList() {
  const { data: rules, isLoading, isError } = useReviewRewardRules();
  const createRule = useCreateReviewRewardRule();
  const updateRule = useUpdateReviewRewardRule();
  const setActive = useSetReviewRewardRuleActive();
  const deleteRule = useDeleteReviewRewardRule();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice = rewardRuleNotice({ isError, rules });

  const handleError = (fallback: string) => (err: unknown) => {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    setError(message ?? fallback);
  };

  return (
    <section className="space-y-3 rounded-[10px] border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">보상 규칙</h2>
          {/*
            「보상이 안 나간다」는 단언은 «목록을 실제로 받아왔을 때만» 한다. 조회가 실패하면
            rules 가 undefined 라 활성 0건과 구별되지 않는데, 이 화면의 존재 이유가 그 단언이다.
          */}
          {notice.kind === 'error' && (
            <p className="mt-1 text-xs text-red-600">
              규칙을 불러오지 못했습니다. <strong>보상이 나가는지 여부를 이 화면으로 판단할 수 없습니다.</strong>
            </p>
          )}
          {notice.kind === 'loading' && <p className="mt-1 text-xs text-gray-400">규칙을 불러오는 중입니다.</p>}
          {notice.kind === 'counted' && (
            <p className="mt-1 text-xs text-gray-500">
              활성 규칙이 <strong>{notice.activeCount}건</strong>입니다.
              {notice.activeCount === 0 && ' 지금은 리뷰를 써도 아무 보상이 나가지 않습니다.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="shrink-0 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          규칙 추가
        </button>
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>}

      {creating && (
        <RuleForm
          value={emptyRuleForm()}
          submitting={createRule.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(value) => {
            setError(null);
            createRule.mutate(value, {
              onSuccess: () => setCreating(false),
              onError: handleError('규칙 생성에 실패했습니다.'),
            });
          }}
        />
      )}

      {isLoading && <p className="text-xs text-gray-400">불러오는 중…</p>}

      {rules && rules.length === 0 && !creating && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
          등록된 규칙이 없습니다. 규칙을 만들지 않으면 리뷰 보상은 나가지 않습니다.
        </p>
      )}

      <ul className="space-y-2">
        {rules?.map((rule) => (
          <li key={rule.id} className="rounded border border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {rule.active ? '활성' : '비활성'}
                  </span>
                  {rule.name}
                  <span className="text-[11px] font-normal text-gray-400">
                    {TRIGGER_LABELS[rule.trigger]} · 우선순위 {rule.priority}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {describeConditions(rule)} → <strong>{describeReward(rule.reward)}</strong> · {describeLimits(rule)}
                </p>
                {(rule.startsAt || rule.endsAt) && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    적용 기간 {formatDateTime(rule.startsAt)} ~ {formatDateTime(rule.endsAt)}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setActive.mutate(
                      { id: rule.id, active: !rule.active },
                      { onError: handleError('활성 상태를 바꾸지 못했습니다.') },
                    );
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
                >
                  {rule.active ? '비활성화' : '활성화'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(editingId === rule.id ? null : rule.id);
                    setCreating(false);
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
                >
                  {editingId === rule.id ? '닫기' : '수정'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`'${rule.name}' 규칙을 삭제할까요? 이미 지급된 내역은 남습니다.`)) return;
                    setError(null);
                    deleteRule.mutate(rule.id, { onError: handleError('삭제하지 못했습니다.') });
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-red-600"
                >
                  삭제
                </button>
              </div>
            </div>

            {editingId === rule.id && (
              <div className="border-t border-gray-200 p-3">
                <RuleForm
                  value={toFormValue(rule)}
                  submitting={updateRule.isPending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(value) => {
                    setError(null);
                    updateRule.mutate(
                      { id: rule.id, dto: value },
                      { onSuccess: () => setEditingId(null), onError: handleError('수정에 실패했습니다.') },
                    );
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
