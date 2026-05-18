'use client';

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { useVersionDetailSuspense } from '@/lib/services/products/queries';

type Props = {
  masterId: string;
  versionId: string;
};

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function InactiveVersionBanner({ masterId, versionId }: Props) {
  const { data } = useVersionDetailSuspense(masterId, versionId);

  // active 버전을 versionId 로 직접 진입한 경우는 안내 배너 의미가 약하지만,
  // 일관성과 명확성을 위해 status=='active' 일 때는 표시 생략.
  if (data.status === 'active') return null;

  const statusLabel = data.status === 'draft' ? 'draft' : 'inactive';

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex flex-1 flex-col gap-1">
        <div className="font-medium text-amber-900">
          v{data.version} ({statusLabel}) — {formatDate(data.createdAt)} 에 생성된 버전을 보고 있습니다.
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-amber-800">
          <Link
            href={`/mall/products-list/${masterId}`}
            className="underline hover:text-amber-900"
          >
            현재 active 버전 보기
          </Link>
          <Link
            href={`/mall/products-list/${masterId}/versions?versionId=${versionId}`}
            className="underline hover:text-amber-900"
          >
            버전 트리 보기
          </Link>
        </div>
      </div>
    </div>
  );
}
