import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  transpilePackages: ["@packages/image-compress"],
  // 로컬 테넌트 도메인(rehearsal.localhost:8001)으로 dev 서버를 열면 Next 가 다른 기원의 dev 자원 요청을 막는다.
  allowedDevOrigins: ["*.localhost"],
  experimental: {
    // 사업자 증빙 파일이 서버 액션 본문으로 온다(기본 1MB). 파일은 @packages/image-compress 의
    // MAX_UPLOAD_BYTES(4MB, Lambda 6MB 한도에서 여유를 뺀 값)까지라 입력값을 더해 5mb 로 둔다.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
