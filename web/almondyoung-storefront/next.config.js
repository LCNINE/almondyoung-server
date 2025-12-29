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
    ],
  },
}

module.exports = nextConfig
