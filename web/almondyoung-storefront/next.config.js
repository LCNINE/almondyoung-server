const checkEnvVariables = require("./check-env-variables")
const path = require("path")
const createNextIntlPlugin = require("next-intl/plugin")

checkEnvVariables()

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const backendDomain =
  process.env.NEXT_PUBLIC_BACKEND_DOMAIN || process.env.BACKEND_DOMAIN
const normalizedBackendDomain = backendDomain
  ? backendDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  : null

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // 빌드/캐시 디렉터리. E2E 는 이걸 갈아끼워 개발 중인 dev 서버의 `.next` 와 캐시를 섞지 않는다.
  // unstable_cache 항목은 `.next/cache` 에 남아 서버를 재시작해도 살아남기 때문에, 캐시를
  // 비운 상태에서 확인해야 하는 시나리오는 디렉터리 자체를 분리해야 한다.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  transpilePackages: ["@packages/web-observability"],
  experimental: {
    // 동적 페이지의 라우터 캐시 유효 시간 (초)
    // 뒤로 가기 시 loading.tsx 깜빡임 방지
    staleTimes: {
      dynamic: 30,
    },
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  turbopack: {
    // 모노레포 루트로 지정해야 root 밖의 @packages/* (예: web-observability) 가 해석됨
    root: path.resolve(__dirname, "../.."),
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  webpack(config) {
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...(config.resolve.modules || ["node_modules"]),
    ]

    // SVG를 React 컴포넌트로 import할 수 있도록 설정
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    })

    return config
  },

  // cafe24 시절 URL(/index.html)로 들어오는 유입 — 카카오 채널 "쇼핑몰 보기" 버튼 등.
  // 미들웨어는 pathname 에 "." 이 있으면 정적 자산으로 보고 통과시키므로,
  // 여기서 먼저 걷어내지 않으면 countryCode 가 "index.html" 로 잡혀 region 조회가 실패한다.
  async redirects() {
    const defaultRegion = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

    return [
      {
        source: "/index.html",
        destination: `/${defaultRegion}`,
        permanent: true,
      },
      {
        source: "/index.html/:path*",
        destination: `/${defaultRegion}/:path*`,
        permanent: true,
      },
    ]
  },

  async headers() {
    return [
      {
        source: "/firebase-messaging-sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]
  },

  images: {
    qualities: [25, 50, 75, 100],
    // 원본(S3)이 Cache-Control 을 안 붙여서 최적화 이미지가 기본값 60초로 나갔다. 60초마다
    // CDN 에서 빠져 매번 이미지 최적화 람다가 원본을 다시 받아 다시 인코딩했다.
    // 파일 URL 은 업로드마다 새 UUID 라 같은 URL 의 내용이 바뀌지 않는다.
    //
    // 주의: 이 값은 /public 자산에도 같이 걸린다. 로고처럼 URL 이 배포 간 고정인 파일은
    // 내용을 바꿔도 최대 이 기간만큼 옛 이미지가 남는다. 브랜드 자산을 교체할 때는
    // 파일명을 바꾸거나 src 에 버전 쿼리(`?v=2`)를 붙여 URL 을 갈아야 한다.
    minimumCacheTTL: 60 * 60 * 24 * 31,
    remotePatterns: [
      ...(normalizedBackendDomain
        ? [
            {
              protocol: "https",
              hostname: `file.${normalizedBackendDomain}`,
            },
          ]
        : []),
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "via.placeholder.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "almondyoung.com",
      },
      {
        protocol: "https",
        hostname: "mentor-hug-20737921.figma.site",
      },
      {
        protocol: "https",
        hostname: "xsjyvxbnmwwsdvyofjfy.supabase.co",
      },
      {
        protocol: "https",
        hostname: "i.pinimg.com",
      },
      {
        protocol: "https",
        hostname: "almondyoung.s3.ap-northeast-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "almondyoung-demo.s3.ap-northeast-2.amazonaws.com",
        pathname: "/**",
      },
      // 디지털 자산 썸네일은 Core 의 file-service 가 서빙한다 (#346, #351).
      // 기존 medusa-digital-asset 버킷은 폐기 — `file.{backendDomain}` 항목이 이를 대체.
      {
        protocol: "https",
        hostname: "almondyoung-public-template.s3.ap-northeast-2.amazonaws.com",
        pathname: "/products/images/**",
      },
      {
        protocol: "https",
        hostname: "almondyoung-public-template.s3.ap-northeast-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "api-gateway-development-10ed.up.railway.app",
      },
      {
        protocol: "https",
        hostname: "fs-development.up.railway.app",
      },
      {
        protocol: "https",
        hostname: "almondyoung-public.s3.ap-northeast-2.amazonaws.com",
        pathname: "/**",
      },
    ],
  },
}

module.exports = withNextIntl(nextConfig)
