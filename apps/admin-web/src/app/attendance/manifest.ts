import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/attendance',
    name: '아몬드영 출결',
    short_name: '출결',
    start_url: '/attendance',
    scope: '/attendance',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#4f46e5',
    lang: 'ko',
    icons: [
      {
        src: '/attendance/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/attendance/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
