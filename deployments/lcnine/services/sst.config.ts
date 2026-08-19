/// <reference path="../../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "lcnine-services",
      // "live" = 운영 stage. 삭제 저항성(retain)과 protect 적용. 도메인도 접두사 없음.
      removal: input?.stage === "live" ? "retain" : "remove",
      protect: ["live"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: { region: "ap-northeast-2" },
      },
    };
  },
  async run() {
    // OpenNext 는 image optimizer 용 sharp 를 `npm install --os=linux --arch=arm64 ...` 로 깐다
    // (installDeps.js). 그런데 sharp 0.32.6 은 플랫폼을 `npm_config_platform` 에서 읽는다
    // (sharp/lib/platform.js) — npm 이 `--os` 를 전파하는 이름은 `npm_config_os` 라 값이 닿지
    // 않고, arch 만 맞은 `sharp-darwin-arm64v8.node` 가 맥에서 그대로 올라간다. Lambda 에서
    // require 가 실패하면 Next 는 그걸 삼키고 원본 이미지를 그대로 반환하므로, 에러 하나 없이
    // 모든 이미지가 무손실 원본으로 나간다. 이 변수는 빌드 프로세스로 상속된다.
    process.env.npm_config_platform = "linux";

    const shared = await import("./infra/shared");
    const services = await import("./infra/services");

    const infra = shared.setup();
    services.setup(infra);

    return {
      dbHost: infra.db.host,
      medusaUrl: infra.url("medusa"),
      walletUrl: infra.url("wallet"),
      storefrontUrl: infra.url("www"),
    };
  },
});
