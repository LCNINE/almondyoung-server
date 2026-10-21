'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

type Props = {
  title: string;
  /** 뒤로 갈 곳. 없으면 뒤로 버튼을 그리지 않는다(첫 화면) */
  backHref?: string;
};

/**
 * 모바일 상단 바 — 스크롤해도 붙어 있고, 뒤로 버튼은 아이콘(24px)에 투명 여백을 둘러 48×48 을 누를 수 있다.
 * 뒤로는 화면 위계를 따른다(채팅 링크로 바로 들어와도 갈 곳이 있게).
 */
export function MobileTopBar({ title, backHref }: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center border-b border-gray-100 bg-white px-1">
      {backHref ? (
        <Link
          href={backHref}
          aria-label="뒤로"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-gray-900 active:bg-gray-100"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-gray-900">{title}</h1>
      {/* 제목이 가운데에 오게 왼쪽 버튼만큼 비운다 */}
      <span className={backHref ? 'w-12 shrink-0' : 'w-3 shrink-0'} />
    </header>
  );
}
