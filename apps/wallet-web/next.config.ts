import type { NextConfig } from 'next';
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
};

export default nextConfig;
