import type {
  BusinessLicenseAutoReview,
  BusinessLicenseAutoReviewReason,
} from '@/lib/types/dto/business-licenses';

export type AutoReviewRowKey =
  | 'documentType'
  | 'representative'
  | 'businessNumber'
  | 'startDate'
  | 'businessType'
  | 'nts';

export type AutoReviewRowResult =
  | { kind: 'pass' }
  | { kind: 'fail'; label: string }
  | { kind: 'skip' };

export const AUTO_REVIEW_ROW_ORDER: readonly AutoReviewRowKey[] = [
  'documentType',
  'representative',
  'businessNumber',
  'startDate',
  'businessType',
  'nts',
];

const SKIP: AutoReviewRowResult = { kind: 'skip' };

interface Stage {
  reason: BusinessLicenseAutoReviewReason;
  fail?: { row: AutoReviewRowKey; label: string };
  passes: readonly AutoReviewRowKey[];
}

// 자동 심사가 확인하는 순서. 한 단계에서 멈추면 그 뒤 행은 확인하지 않은 것이다.
const STAGES: readonly Stage[] = [
  {
    reason: 'not_license',
    fail: { row: 'documentType', label: '다름' },
    passes: ['documentType'],
  },
  { reason: 'unreadable', passes: [] },
  {
    reason: 'corporation',
    fail: { row: 'businessType', label: '다름' },
    passes: ['businessType'],
  },
  {
    reason: 'name_mismatch',
    fail: { row: 'representative', label: '다름' },
    passes: ['representative'],
  },
  {
    reason: 'nts_mismatch',
    fail: { row: 'nts', label: '불일치' },
    passes: ['startDate'],
  },
  {
    reason: 'not_active',
    fail: { row: 'nts', label: '불일치' },
    passes: ['nts'],
  },
  {
    reason: 'duplicate_number',
    fail: { row: 'businessNumber', label: '중복' },
    passes: ['businessNumber'],
  },
];

function stopReason(
  autoReview: Pick<BusinessLicenseAutoReview, 'decision' | 'reason'>
): BusinessLicenseAutoReviewReason | null | undefined {
  if (autoReview.decision === 'approve') return null;

  if (autoReview.decision === 'retry') return 'nts_mismatch';

  return autoReview.reason;
}

export function deriveAutoReviewRows(
  autoReview: Pick<BusinessLicenseAutoReview, 'decision' | 'reason' | 'dryRun'>
): Record<AutoReviewRowKey, AutoReviewRowResult> {
  const results: Record<AutoReviewRowKey, AutoReviewRowResult> = {
    documentType: SKIP,
    representative: SKIP,
    businessNumber: SKIP,
    startDate: SKIP,
    businessType: SKIP,
    nts: SKIP,
  };
  const stop = stopReason(autoReview);
  const stopIndex = STAGES.findIndex((stage) => stage.reason === stop);

  if (stop !== null && stopIndex === -1) return results;

  for (const stage of STAGES) {
    if (stage.reason === stop) {
      if (autoReview.decision === 'manual' && stage.fail) {
        results[stage.fail.row] = { kind: 'fail', label: stage.fail.label };
      }

      break;
    }

    for (const row of stage.passes) {
      results[row] = { kind: 'pass' };
    }
  }

  // 번호 중복은 승인 UPDATE 가 막혀야 알 수 있는데, 판정만 기록하면 그 UPDATE 를 건너뛴다.
  if (autoReview.decision === 'approve' && autoReview.dryRun) {
    results.businessNumber = SKIP;
  }

  return results;
}

export function formatBusinessNumber(value: string | null): string {
  if (!value) return '-';

  const digits = value.replace(/\D/g, '');

  if (digits.length !== 10) return value;

  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
