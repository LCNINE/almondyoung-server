const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

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
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
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
      {
        protocol: "https",
        hostname:
          "almondyoung-medusa-digital-asset.s3.ap-northeast-2.amazonaws.com",
      },
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

      // 임시: demo 환경 file service
      {
        protocol: "https",
        hostname: "file.almondyoung-next.com",
      },
    ],
  },
}

module.exports = nextConfig
