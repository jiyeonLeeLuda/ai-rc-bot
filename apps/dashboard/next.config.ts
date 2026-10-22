import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @snack-express/protocol 패키지를 Next.js 번들러가 직접 트랜스파일할 수 있게 설정
  transpilePackages: ["@snack-express/protocol"],
};

export default nextConfig;
