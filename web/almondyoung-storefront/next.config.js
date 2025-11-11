const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  // 성능 최적화 설정
  experimental: {
    // optimizeCss: true, // critters 모듈 오류로 인해 비활성화
    optimizePackageImports: ["@components", "@lib"],
  },

  async redirects() {
    return [
      // payment 관련
      {
        source: "/:countryCode/mypage/payment/manage",
        destination: "/:countryCode/mypage/payment-methods",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/payment/register",
        destination: "/:countryCode/mypage/payment-methods/add",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/payment/form",
        destination: "/:countryCode/mypage/membership/subscribe/payment",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/payment/phone",
        destination: "/:countryCode/mypage/payment-methods/verify",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/payment/card",
        destination: "/:countryCode/mypage/payment-methods",
        permanent: true,
      },

      // membership 관련
      {
        source: "/:countryCode/mypage/membership/fee-method",
        destination: "/:countryCode/mypage/membership/payment-method",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/membership/success",
        destination: "/:countryCode/mypage/membership/subscribe/success",
        permanent: true,
      },
      {
        source: "/:countryCode/mypage/membership/fail",
        destination: "/:countryCode/mypage/membership/subscribe/fail",
        permanent: true,
      },
    ]
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.BACKEND_URL + "/:path*",
      },
    ]
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    remotePatterns: [
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
    ],
  },
}

module.exports = nextConfig
