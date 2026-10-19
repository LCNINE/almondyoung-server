import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/attendance',
    name: '아몬드영 워크',
    short_name: '아몬드영 워크',
    description: '아몬드영의 오늘 근무, 휴가 일정과 알림을 한곳에서 확인해요.',
    start_url: '/attendance',
    scope: '/attendance',
    display: 'standalone',
    background_color: '#FFFBF5',
    theme_color: '#f8fafc',
    lang: 'ko',
    icons: [
      {
        src: '/attendance/icon-192.png?v=clock-2',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/attendance/icon-512.png?v=clock-2',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/attendance/icon-512.png?v=clock-2',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
