'use client';

import { useState } from 'react';
import {
  BEST_SELECTION_MODES,
  BestSelectionMode,
  REVIEW_REWARD_KINDS,
  REVIEW_REWARD_PERIODS,
  REVIEW_REWARD_TRIGGERS,
  REVIEW_TYPE_FILTERS,
  ReviewRewardKind,
  ReviewRewardLimitSpec,
  ReviewRewardPeriod,
  ReviewRewardTrigger,
  ReviewTypeFilter,
  UpsertReviewRewardRuleDto,
} from '@/lib/types/dto/review-reward';
import {
  BEST_MODE_LABELS,
  PERIOD_LABELS,
  REVIEW_TYPE_LABELS,
  REWARD_KIND_LABELS,
  TRIGGER_LABELS,
} from '../shared';

interface RuleFormProps {
  value: UpsertReviewRewardRuleDto;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (value: UpsertReviewRewardRuleDto) => void;
}

const inputClass = 'rounded border border-gray-200 bg-white px-2 py-1.5 text-xs tabular-nums';
const labelClass = 'flex flex-col gap-1 text-xs text-gray-500';

function toNumberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function RuleForm({ value, submitting, onCancel, onSubmit }: RuleFormProps) {
  const [form, setForm] = useState<UpsertReviewRewardRuleDto>(value);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<UpsertReviewRewardRuleDto>) => setForm((prev) => ({ ...prev, ...partial }));
  const patchConditions = (partial: Partial<UpsertReviewRewardRuleDto['conditions']>) =>
    setForm((prev) => ({ ...prev, conditions: { ...prev.conditions, ...partial } }));
  const patchReward = (partial: Partial<UpsertReviewRewardRuleDto['reward']>) =>
    setForm((prev) => ({ ...prev, reward: { ...prev.reward, ...partial } }));

  const setLimit = (key: 'perUser' | 'global', spec: ReviewRewardLimitSpec | null) =>
    setForm((prev) => ({ ...prev, limits: { ...prev.limits, [key]: spec } }));

  const changeTrigger = (trigger: ReviewRewardTrigger) => {
    setForm((prev) => ({
      ...prev,
      trigger,
      conditions: {
        ...prev.conditions,
        // 주간 베스트는 선정 방식·인원이 있어야 한다. 리뷰 작성 트리거로 돌아가면 그 값은 의미가 없다.
        best:
          trigger === 'WEEKLY_BEST'
            ? (prev.conditions.best ?? { mode: 'HELPFUL_COUNT', topN: 3, minHelpfulCount: 1 })
            : null,
      },
    }));
  };

  const submit = () => {
    if (!form.name.trim()) {
      setError('규칙 이름을 입력하세요.');
      return;
    }
    if (form.reward.kind === 'POINT_FIXED' && !form.reward.amount) {
      setError('정액 보상에는 지급액이 필요합니다.');
      return;
    }
    if (form.reward.kind === 'POINT_RATE') {
      if (!form.reward.ratePercent) {
        setError('정률 보상에는 지급 비율이 필요합니다.');
        return;
      }
      if (form.trigger === 'WEEKLY_BEST') {
        setError('주간 베스트에는 정률 보상을 쓸 수 없습니다 — 주문 금액에 붙는 보상이 아닙니다.');
        return;
      }
    }
    setError(null);
    onSubmit(form);
  };

  return (
    <div className="space-y-4 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} w-56`}>
          <span>규칙 이름</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="예: 포토리뷰 100원"
            maxLength={100}
          />
        </label>
        <label className={labelClass}>
          <span>언제 평가하나</span>
          <select
            className={inputClass}
            value={form.trigger}
            onChange={(event) => changeTrigger(event.target.value as ReviewRewardTrigger)}
          >
            {REVIEW_REWARD_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {TRIGGER_LABELS[trigger]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>우선순위 (큰 값 먼저)</span>
          <input
            type="number"
            className={`${inputClass} w-24`}
            value={form.priority}
            onChange={(event) => patch({ priority: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={form.stopOnMatch}
            onChange={(event) => patch({ stopOnMatch: event.target.checked })}
          />
          <span>이 규칙이 맞으면 뒤 규칙은 보지 않음</span>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={form.active} onChange={(event) => patch({ active: event.target.checked })} />
          <span className="font-medium">지금 활성화</span>
        </label>
      </div>

      <label className={`${labelClass} w-full`}>
        <span>설명 (선택)</span>
        <input
          className={inputClass}
          value={form.description ?? ''}
          onChange={(event) => patch({ description: event.target.value || null })}
          placeholder="이 규칙을 왜 켰는지 적어두면 나중에 판단이 쉽습니다"
        />
      </label>

      <fieldset className="space-y-2 rounded border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">조건 — 어떤 리뷰에 적용하나</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            <span>리뷰 종류</span>
            <select
              className={inputClass}
              value={form.conditions.reviewType}
              onChange={(event) => patchConditions({ reviewType: event.target.value as ReviewTypeFilter })}
            >
              {REVIEW_TYPE_FILTERS.map((type) => (
                <option key={type} value={type}>
                  {REVIEW_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span>최소 글자수</span>
            <input
              type="number"
              min={0}
              className={`${inputClass} w-24`}
              value={form.conditions.minContentLength}
              onChange={(event) => patchConditions({ minContentLength: Number(event.target.value) || 0 })}
            />
          </label>
          <label className={labelClass}>
            <span>최소 사진 수</span>
            <input
              type="number"
              min={0}
              className={`${inputClass} w-24`}
              value={form.conditions.minMediaCount}
              onChange={(event) => patchConditions({ minMediaCount: Number(event.target.value) || 0 })}
            />
          </label>
          <label className={labelClass}>
            <span>최소 별점 (비우면 무관)</span>
            <input
              type="number"
              min={1}
              max={5}
              className={`${inputClass} w-24`}
              value={form.conditions.minRating ?? ''}
              onChange={(event) => patchConditions({ minRating: toNumberOrNull(event.target.value) })}
            />
          </label>
          <label className={labelClass}>
            <span>N번째 리뷰마다 (비우면 매번)</span>
            <input
              type="number"
              min={1}
              className={`${inputClass} w-32`}
              value={form.conditions.everyNthReview ?? ''}
              onChange={(event) => patchConditions({ everyNthReview: toNumberOrNull(event.target.value) })}
            />
          </label>
        </div>

        {form.trigger === 'WEEKLY_BEST' && form.conditions.best && (
          <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
            <label className={labelClass}>
              <span>선정 방식</span>
              <select
                className={inputClass}
                value={form.conditions.best.mode}
                onChange={(event) =>
                  patchConditions({
                    best: { ...form.conditions.best!, mode: event.target.value as BestSelectionMode },
                  })
                }
              >
                {BEST_SELECTION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {BEST_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span>주당 선정 인원</span>
              <input
                type="number"
                min={1}
                className={`${inputClass} w-24`}
                value={form.conditions.best.topN}
                onChange={(event) =>
                  patchConditions({ best: { ...form.conditions.best!, topN: Number(event.target.value) || 1 } })
                }
              />
            </label>
            <label className={labelClass}>
              <span>최소 추천수</span>
              <input
                type="number"
                min={0}
                className={`${inputClass} w-24`}
                value={form.conditions.best.minHelpfulCount}
                onChange={(event) =>
                  patchConditions({
                    best: { ...form.conditions.best!, minHelpfulCount: Number(event.target.value) || 0 },
                  })
                }
              />
            </label>
            <p className="pb-1.5 text-[11px] text-gray-500">
              후보는 매주 월요일 04시(KST)에 자동으로 뽑히고, <strong>확정 버튼을 눌러야</strong> 지급됩니다.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2 rounded border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">보상 — 무엇을 주나</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            <span>종류</span>
            <select
              className={inputClass}
              value={form.reward.kind}
              onChange={(event) => patchReward({ kind: event.target.value as ReviewRewardKind })}
            >
              {REVIEW_REWARD_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {REWARD_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>

          {form.reward.kind === 'POINT_FIXED' && (
            <label className={labelClass}>
              <span>지급액 (원)</span>
              <input
                type="number"
                min={0}
                className={`${inputClass} w-28`}
                value={form.reward.amount ?? ''}
                onChange={(event) => patchReward({ amount: toNumberOrNull(event.target.value) ?? undefined })}
              />
            </label>
          )}

          {form.reward.kind === 'POINT_RATE' && (
            <>
              <label className={labelClass}>
                <span>비율 (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={`${inputClass} w-20`}
                  value={form.reward.ratePercent ?? ''}
                  onChange={(event) => patchReward({ ratePercent: toNumberOrNull(event.target.value) ?? undefined })}
                />
              </label>
              <label className={labelClass}>
                <span>최소액 (원)</span>
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} w-24`}
                  value={form.reward.minAmount ?? ''}
                  onChange={(event) => patchReward({ minAmount: toNumberOrNull(event.target.value) })}
                />
              </label>
              <label className={labelClass}>
                <span>상한 (원)</span>
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} w-24`}
                  value={form.reward.maxAmount ?? ''}
                  onChange={(event) => patchReward({ maxAmount: toNumberOrNull(event.target.value) })}
                />
              </label>
            </>
          )}

          {(form.reward.kind === 'POINT_FIXED' || form.reward.kind === 'POINT_RATE') && (
            <label className={labelClass}>
              <span>만료일수 (비우면 만료 없음)</span>
              <input
                type="number"
                min={1}
                className={`${inputClass} w-32`}
                value={form.reward.expiresInDays ?? ''}
                onChange={(event) => patchReward({ expiresInDays: toNumberOrNull(event.target.value) })}
              />
            </label>
          )}
        </div>
        {form.reward.kind === 'POINT_RATE' && (
          <p className="text-[11px] text-gray-500">
            정률은 <strong>주문 라인 결제금액</strong>을 모수로 씁니다. 금액을 모르는 주문(이 기능 이전 주문 포함)은
            지급하지 않고 &lsquo;주문 금액을 알 수 없음&rsquo; 사유로 지급 내역에 남습니다 — 0원으로 지급하지 않습니다.
          </p>
        )}
        {(form.reward.kind === 'POINT_FIXED' || form.reward.kind === 'POINT_RATE') && !form.reward.expiresInDays && (
          <p className="text-[11px] text-amber-600">
            만료일수를 비우면 적립금이 영구히 남습니다. 회계상 부채로 쌓이니 기간을 넣는 편을 권합니다.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-2 rounded border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">한도 — 얼마까지 나가게 하나</legend>
        <LimitEditor
          title="1인당"
          spec={form.limits.perUser}
          onChange={(spec) => setLimit('perUser', spec)}
        />
        <LimitEditor title="전체 예산" spec={form.limits.global} onChange={(spec) => setLimit('global', spec)} />
        <p className="text-[11px] text-gray-500">한도는 <strong>이 규칙이 지급한 건</strong>만 세어 판정합니다.</p>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <label className={labelClass}>
          <span>적용 시작 (선택)</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={form.startsAt ? form.startsAt.slice(0, 16) : ''}
            onChange={(event) => patch({ startsAt: event.target.value ? new Date(event.target.value).toISOString() : null })}
          />
        </label>
        <label className={labelClass}>
          <span>적용 종료 (선택)</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={form.endsAt ? form.endsAt.slice(0, 16) : ''}
            onChange={(event) => patch({ endsAt: event.target.value ? new Date(event.target.value).toISOString() : null })}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function LimitEditor({
  title,
  spec,
  onChange,
}: {
  title: string;
  spec: ReviewRewardLimitSpec | null;
  onChange: (spec: ReviewRewardLimitSpec | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={spec !== null}
          onChange={(event) =>
            onChange(event.target.checked ? { period: 'MONTH', maxCount: null, maxAmount: null } : null)
          }
        />
        <span className="font-medium">{title} 한도</span>
      </label>

      {spec && (
        <>
          <label className={labelClass}>
            <span>기간</span>
            <select
              className={inputClass}
              value={spec.period}
              onChange={(event) => onChange({ ...spec, period: event.target.value as ReviewRewardPeriod })}
            >
              {REVIEW_REWARD_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span>최대 건수</span>
            <input
              type="number"
              min={1}
              className={`${inputClass} w-24`}
              value={spec.maxCount ?? ''}
              onChange={(event) => onChange({ ...spec, maxCount: toNumberOrNull(event.target.value) })}
            />
          </label>
          <label className={labelClass}>
            <span>최대 금액 (원)</span>
            <input
              type="number"
              min={1}
              className={`${inputClass} w-28`}
              value={spec.maxAmount ?? ''}
              onChange={(event) => onChange({ ...spec, maxAmount: toNumberOrNull(event.target.value) })}
            />
          </label>
        </>
      )}
    </div>
  );
}
