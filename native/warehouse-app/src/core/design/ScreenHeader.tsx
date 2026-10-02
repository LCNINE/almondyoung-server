import { useContext, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { ShellChromeContext } from './shellChrome';

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
  const { hidesHomeBack } = useContext(ShellChromeContext);
  // 스테이션 셸에는 홈이 없다(탭 바가 홈) — 홈으로 가는 뒤로는 첫 탭으로 튀기만 한다.
  const showBack = !(hidesHomeBack && backTo === '/');
  return (
    <div className="flex items-center gap-2">
      {showBack && (
        <Link
          to={backTo}
          aria-label="뒤로"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white active:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5 text-gray-700" aria-hidden />
        </Link>
      )}
      <h1 className="flex-1 truncate text-lg font-semibold text-gray-800">{title}</h1>
      {right ? <div className="shrink-0 text-sm text-gray-600">{right}</div> : null}
    </div>
  );
}
