import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 로컬에서 확인용으로 빌드·개발서버를 돌릴 때 배포가 쓰는 `.next` 를 덮어쓰지 않게 한다.
  // 값을 안 주면 기본값 그대로라 배포 경로는 달라지지 않는다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['dagre', '@packages/web-observability'],
  // Next.js 15부터 instrumentationHook은 stable로 전환되어 experimental 설정이 불필요
  // experimental: {
  //   instrumentationHook: true,
  // },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },
};

export default nextConfig;
