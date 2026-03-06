/** @format */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MobileHomePage() {
  const router = useRouter();

  useEffect(() => {
    // 모바일 홈 페이지 접근 시 스케줄 페이지로 리다이렉트 (명백한 모바일 경로)
    router.replace('/mobile/schedule');
  }, [router]);

  // 리다이렉트 중 로딩 표시
  return (
    <section className="flex flex-col min-h-screen bg-gray-50">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    </section>
  );
}