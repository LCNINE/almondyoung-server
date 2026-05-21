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
  reactStrictMode: true,
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
    root: path.resolve(__dirname),
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  webpack(config) {
    // SVG를 React 컴포넌트로 import할 수 있도록 설정
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    })

    return config
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
