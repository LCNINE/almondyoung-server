// src/components/providers/mock-provider.tsx
'use client';

import { useEffect, useState } from 'react';

const USE_MOCK = true; // 개발 중에는 항상 MSW 사용

export function MockProvider({ children }: { children: React.ReactNode }) {
  const [mockReady, setMockReady] = useState(!USE_MOCK); // mock 미사용이면 바로 ready

  useEffect(() => {
    const initMock = async () => {
      if (typeof window === 'undefined') return;

      if (USE_MOCK) {
        try {
          console.log('🚀 MSW 초기화 시작...');
          const { worker } = await import('@/lib/mock/browser');
          await worker.start({
            onUnhandledRequest: 'warn',
            serviceWorker: { url: '/mockServiceWorker.js' },
            quiet: false,
          });
          console.log('✅ MSW가 성공적으로 시작되었습니다');
        } catch (error) {
          console.error('❌ MSW 시작 실패:', error);
        }
      } else {
        console.log('⏭️ MSW 건너뛰기 - USE_MOCK이 false');
      }
      setMockReady(true);
    };

    initMock();
  }, []);

  // 준비되기 전에는 렌더 지연 (레이스 방지)
  if (!mockReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Mock 서버 준비 중...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
