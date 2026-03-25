import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['dagre'],
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
