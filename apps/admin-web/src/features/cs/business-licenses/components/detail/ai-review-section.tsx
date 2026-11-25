import Link from 'next/link';
import { ChevronRight, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  BusinessLicenseAutoReview,
  BusinessLicenseAutoReviewReason,
  BusinessLicenseDuplicateOwner,
  BusinessLicenseNtsValidate,
} from '@/lib/types/dto/business-licenses';
import {
  AUTO_REVIEW_ROW_ORDER,
  type AutoReviewRowKey,
  type AutoReviewRowResult,
  businessTypeTarget,
  deriveAutoReviewRows,
  formatBusinessNumber,
} from './ai-review-rows';

const REASON_COPY: Record<
  BusinessLicenseAutoReviewReason,
  { title: string; description: string }
> = {
  name_mismatch: {
    title: '등록증의 대표자 이름이 가입 계정 이름과 다릅니다',
    description:
      '다른 사람의 등록증일 수 있어 국세청 조회 전에 멈췄습니다. 계정 주인이 대표자 본인인지 확인해 주세요. 가족이나 직원 계정으로 신청한 경우가 많습니다.',
  },
  duplicate_number: {
    title: '같은 사업자등록번호를 다른 계정이 이미 등록했습니다',
    description:
      '판독과 국세청 확인은 모두 통과했습니다. 기존 계정과 같은 사람인지, 공동 운영자인지 확인해 주세요.',
  },
  not_license: {
    title: '사업자등록증이 아닌 서류입니다',
    description: '다른 서류를 올렸는지 확인해 주세요.',
  },
  unreadable: {
    title: '등록증 글자를 확실히 읽지 못했습니다',
    description: '이미지를 직접 보고 번호와 대표자를 확인해 주세요.',
  },
  corporation: {
    title: '법인사업자는 자동 심사 대상이 아닙니다',
    description: '법인 서류를 직접 확인해 주세요.',
  },
  nts_mismatch: {
    title: '국세청 진위확인에서 일치하지 않았습니다',
    description: '개업일자나 대표자명이 등록증과 같은지 확인해 주세요.',
  },
  not_active: {
    title: '국세청 기준 계속사업자가 아닙니다',
    description: '휴업이나 폐업 상태인지 확인해 주세요.',
  },
  image_unavailable: {
    title: '등록증 이미지를 열지 못했습니다',
    description: '파일이 깨졌거나 지원하지 않는 형식일 수 있습니다.',
  },
};

const ROW_LABELS: Record<AutoReviewRowKey, string> = {
  documentType: '서류 종류',
  representative: '대표자',
  businessNumber: '사업자등록번호',
  startDate: '개업일자',
  businessType: '사업자 구분',
  nts: '국세청 진위확인',
};

function reasonCopy(autoReview: BusinessLicenseAutoReview): {
  title: string;
  description?: string;
} {
  if (autoReview.decision === 'approve') {
    return {
      title: autoReview.dryRun
        ? '모든 확인을 통과했습니다. 판정만 기록하고 승인하지 않았습니다'
        : '모든 확인을 통과해 자동 승인했습니다',
    };
  }

  if (autoReview.decision === 'retry' || !autoReview.reason) {
    return { title: '국세청 조회가 실패해 다음 주기에 다시 확인합니다' };
  }

  return REASON_COPY[autoReview.reason];
}

function DecisionBadge({
  decision,
}: {
  decision: BusinessLicenseAutoReview['decision'];
}) {
  if (decision === 'manual') {
    return (
      <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
        사람 확인 필요
      </Badge>
    );
  }

  if (decision === 'approve') return <Badge>자동 승인</Badge>;

  return <Badge variant="secondary">재시도 대기</Badge>;
}

function formatDate(value: string | null): string {
  if (!value) return '-';

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return value;
}

function ResultCell({
  result,
  passLabel,
}: {
  result: AutoReviewRowResult;
  passLabel: string;
}) {
  if (result.kind === 'fail') {
    return <span className="font-semibold text-red-700">{result.label}</span>;
  }

  if (result.kind === 'pass') {
    return <span className="text-green-700">{passLabel}</span>;
  }

  return <span className="text-gray-400">-</span>;
}

function DuplicateOwnerTarget({
  duplicateOf,
}: {
  duplicateOf: BusinessLicenseDuplicateOwner | null | undefined;
}) {
  if (!duplicateOf) return <>이미 등록된 계정을 찾지 못했습니다</>;

  const approval = duplicateOf.verifiedAt
    ? `${new Date(duplicateOf.verifiedAt).toLocaleDateString('sv-SE')} 승인`
    : '승인 기록 없음';

  return (
    <div className="space-y-0.5">
      <Link
        href={`/users/${duplicateOf.userId}`}
        className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline"
      >
        {duplicateOf.userName ?? '-'} · {duplicateOf.email ?? '-'}
        <ChevronRight className="w-4 h-4" />
      </Link>
      <p className="text-xs text-gray-500">
        {approval} · 누르면 회원 상세로 이동
      </p>
    </div>
  );
}

function ntsReadValue(ntsValidate: BusinessLicenseNtsValidate | undefined) {
  if (!ntsValidate) return '조회하지 않았습니다';

  if (ntsValidate.valid) return `일치 · ${ntsValidate.status}`;

  return ntsValidate.invalidReason ?? ntsValidate.status;
}

export function AiReviewSection({
  autoReview,
  userName,
  ntsValidate,
  duplicateOf,
}: {
  autoReview: BusinessLicenseAutoReview;
  userName: string | null | undefined;
  ntsValidate: BusinessLicenseNtsValidate | undefined;
  duplicateOf: BusinessLicenseDuplicateOwner | null | undefined;
}) {
  const copy = reasonCopy(autoReview);
  const reading = autoReview.reading;
  const results = deriveAutoReviewRows(autoReview);
  const isDuplicate =
    autoReview.decision === 'manual' &&
    autoReview.reason === 'duplicate_number';

  const cells: Record<
    AutoReviewRowKey,
    { read: React.ReactNode; target: React.ReactNode }
  > | null = reading
    ? {
        documentType: {
          read: reading.isBusinessRegistration
            ? '사업자등록증'
            : '사업자등록증 아님',
          target: '사업자등록증',
        },
        representative: {
          read: reading.representativeName ?? '-',
          target: `${userName ?? '-'} (계정 이름)`,
        },
        businessNumber: {
          read: (
            <span className="font-mono">
              {formatBusinessNumber(reading.businessNumber)}
            </span>
          ),
          target: isDuplicate ? (
            <DuplicateOwnerTarget duplicateOf={duplicateOf} />
          ) : (
            '다른 계정과 중복 여부'
          ),
        },
        startDate: {
          read: formatDate(reading.startDate),
          target: '-',
        },
        businessType: {
          read: reading.isCorporation ? '법인' : '개인',
          target: businessTypeTarget(autoReview),
        },
        nts: {
          read: ntsReadValue(ntsValidate),
          target: '국세청',
        },
      }
    : null;

  return (
    <section className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gray-700" />
          <h3 className="text-sm font-semibold text-gray-900">AI 판독</h3>
          <DecisionBadge decision={autoReview.decision} />
          {autoReview.dryRun && (
            <span className="text-xs text-gray-500">판정만 기록</span>
          )}
        </div>
        <span className="text-xs text-gray-500">
          {autoReview.model} ·{' '}
          {new Date(autoReview.reviewedAt).toLocaleString('ko-KR')}
        </span>
      </div>

      <div className="p-3 space-y-1 border border-gray-200 rounded-md bg-gray-50">
        <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
        {copy.description && (
          <p className="text-sm text-gray-500">{copy.description}</p>
        )}
      </div>

      {cells && (
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium whitespace-nowrap">항목</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  등록증에서 읽은 값
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  대조 대상
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">결과</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {AUTO_REVIEW_ROW_ORDER.map((key) => (
                <tr
                  key={key}
                  className={cn(results[key].kind === 'fail' && 'bg-red-50')}
                >
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {ROW_LABELS[key]}
                  </td>
                  <td className="px-3 py-2">{cells[key].read}</td>
                  <td className="px-3 py-2">{cells[key].target}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <ResultCell
                      result={results[key]}
                      passLabel={
                        key === 'businessNumber' ? '중복 없음' : '맞음'
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
