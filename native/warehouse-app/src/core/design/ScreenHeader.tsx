import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/** 워크플로우 화면 공통 헤더 — 뒤로 + 제목 + 우측 슬롯(진행률·창고 등). */
export function ScreenHeader({
  title,
  backTo,
  right,
}: {
  title: string;
  backTo: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to={backTo}
        aria-label="뒤로"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white active:bg-gray-100"
      >
        <ChevronLeft className="h-5 w-5 text-gray-700" aria-hidden />
      </Link>
      <h1 className="flex-1 truncate text-lg font-semibold text-gray-800">{title}</h1>
      {right ? <div className="shrink-0 text-sm text-gray-600">{right}</div> : null}
    </div>
  );
}
