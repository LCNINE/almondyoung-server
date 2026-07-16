'use client';

import { PlaceholderCell } from '../common/placeholder-cell';

// FO 상태 → 한글 라벨 + 색상 클래스 매핑 (FulfillmentOrderStatus 전체)
const FO_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  created: { label: '생성됨', className: 'bg-gray-100 text-gray-600' },
  partially_reserved: { label: '부분예약', className: 'bg-blue-100 text-blue-700' },
  ready: { label: '준비됨', className: 'bg-blue-100 text-blue-700' },
  processing: { label: '처리중', className: 'bg-amber-100 text-amber-700' },
  partially_shipped: { label: '부분출고', className: 'bg-teal-100 text-teal-700' },
  shipped: { label: '출고완료', className: 'bg-green-100 text-green-700' },
  completed: { label: '완료', className: 'bg-green-100 text-green-700' },
  canceled: { label: '취소됨', className: 'bg-red-100 text-red-700' },
  recovery_required: { label: '복구필요', className: 'bg-red-100 text-red-700' },
};

export function FoStatusBadge({ status }: { status: string | null | undefined }) {
  if (status == null) return <PlaceholderCell />;
  const cfg = FO_STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export const FoStatusCell = ({ value }: { value: string | null | undefined }) => (
  <FoStatusBadge status={value} />
);

// 우선순위 라벨 + 색상
const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  normal: { label: '보통', className: 'text-gray-600' },
  high: { label: '높음', className: 'text-orange-600 font-medium' },
  urgent: { label: '긴급', className: 'text-red-600 font-semibold' },
};

export const FoPriorityCell = ({ value }: { value: string | null | undefined }) => {
  if (value == null) return <PlaceholderCell />;
  const cfg = PRIORITY_CONFIG[value] ?? { label: value, className: 'text-gray-600' };
  return <span className={`text-xs ${cfg.className}`}>{cfg.label}</span>;
};

// 출고 모드 라벨
const MODE_LABEL: Record<string, string> = {
  in_house: '자가출고',
  '3pl': '3PL',
  drop_ship: '직배송',
};

export const FoModeCell = ({ value }: { value: string | null | undefined }) => {
  if (value == null) return <PlaceholderCell />;
  return <span className="text-xs">{MODE_LABEL[value] ?? value}</span>;
};
