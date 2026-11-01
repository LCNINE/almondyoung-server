import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  // 로컬 테넌트 도메인(rehearsal.localhost:8001)으로 dev 서버를 열면 Next 가 다른 기원의 dev 자원 요청을 막는다.
  allowedDevOrigins: ["*.localhost"],
};

export default nextConfig;
