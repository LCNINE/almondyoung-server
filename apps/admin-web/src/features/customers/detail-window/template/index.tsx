'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/ui';
import { MemberSummary } from '../components/member-summary';
import { HomeTab } from '../components/tabs/home-tab';
import { PlaceholderTab } from '../components/tabs/placeholder-tab';

export type TabKey =
  | 'home'
  | 'detail'
  | 'orders'
  | 'inquiries'
  | 'points'
  | 'cart'
  | 'messages';

const MENU: { key: TabKey; label: string }[] = [
  { key: 'home', label: '홈' },
  { key: 'detail', label: '회원 상세정보' },
  { key: 'orders', label: '주문내역' },
  { key: 'inquiries', label: '문의내역' },
  { key: 'points', label: '적립금/쿠폰' },
  { key: 'cart', label: '장바구니 정보' },
  { key: 'messages', label: '메시지 발송내역' },
];

export default function CustomerDetailWindowTemplate({
  customerId,
}: {
  customerId: string;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      {/* 보라 헤더 */}
      <header className="flex h-12 shrink-0 items-center justify-center bg-[#332e81] text-base font-semibold text-white">
        회원정보조회
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 회원 요약 + 메뉴 */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-gray-200 bg-white">
          <MemberSummary customerId={customerId} />
          <nav className="flex flex-col">
            {MENU.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  'px-5 py-3 text-left text-sm transition-colors',
                  activeTab === item.key
                    ? 'bg-amber-100 font-semibold text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* 우측: 탭 콘텐츠 */}
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {activeTab === 'home' && <HomeTab customerId={customerId} />}
          {activeTab === 'detail' && (
            <PlaceholderTab title="회원 상세정보" />
          )}
          {activeTab === 'orders' && <PlaceholderTab title="주문내역" />}
          {activeTab === 'inquiries' && <PlaceholderTab title="문의내역" />}
          {activeTab === 'points' && <PlaceholderTab title="적립금/쿠폰" />}
          {activeTab === 'cart' && <PlaceholderTab title="장바구니 정보" />}
          {activeTab === 'messages' && (
            <PlaceholderTab title="메시지 발송내역" />
          )}
        </main>
      </div>
    </div>
  );
}
