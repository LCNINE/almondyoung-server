import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';

const nextConfig: NextConfig = {
  // packages/web-observability 가 앱 디렉터리 밖(레포 루트)에 있어서 Turbopack 의
  // workspace root 가 앱 디렉터리로 추론되면 '../../packages/...' 가 root 밖으로
  // 새어 resolve 가 안 된다. dev(turbopack) 에서 resolve 되도록 root 를 레포 루트로
  // 고정. (build 는 --webpack 으로 돌리므로 build 의 resolve 는 webpack 이 처리.)
  //
  // outputFileTracingRoot 는 일부러 건드리지 않는다. OpenNext 가 앱 디렉터리의
  // package-lock.json 으로 monorepoRoot=앱디렉터리 라 판단하고 standalone 출력/번들
  // 경로를 그 기준으로 잡기 때문에, 여기서 레포 루트로 덮으면 출력 레이아웃이
  // OpenNext 기대와 어긋나 ENOENT 가 난다.
  turbopack: { root: path.join(__dirname, '../..') },
  transpilePackages: ['@packages/web-observability'],
  // 체크아웃 주문상품 썸네일은 file-service 가 서빙한다. 로컬은 localhost:3010,
  // 배포는 file.<도메인> (storefront next.config.js 의 remotePatterns 와 같은 출처).
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'file.almondyoung.com' },
      ...(process.env.NEXT_PUBLIC_BACKEND_DOMAIN
        ? [{ protocol: 'https' as const, hostname: `file.${process.env.NEXT_PUBLIC_BACKEND_DOMAIN.replace(/^https?:\/\//, '')}` }]
        : []),
      { protocol: 'http' as const, hostname: 'localhost' },
    ],
  },
};

// storefront 에서 이식한 체크아웃 UI 가 next-intl 로 다국어를 쓴다. URL 에 locale 세그먼트가
// 없으므로 routing 없이 request config 만 붙인다.
export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
