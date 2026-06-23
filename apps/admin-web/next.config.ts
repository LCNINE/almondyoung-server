import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
