/// <reference path="../../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const isLive = input?.stage === 'live';
    const isDemo = input?.stage === 'demo';
    return {
      name: 'lcnine-services',
      // "live" = 운영 stage. 삭제 저항성(retain)과 protect 적용. 도메인도 접두사 없음.
      removal: isLive ? 'retain' : 'remove',
      protect: isLive || isDemo,
      home: 'aws',
      // state 버킷(sst-state-*)은 버전 관리가 켜져 있고, 배포 중 리소스가 바뀔 때마다 현재 state 파일을 통째로
      // 다시 써서 옛 버전이 끝없이 쌓였다(2026-10-24: app/ 아래 옛 버전 88,244개 467GB).
      // retention 은 «완료된 배포 횟수» 단위로 최근 N개의 스냅샷만 남기고, 배포가 끝날 때마다 그보다 오래된
      // 스냅샷·이벤트 로그와 현재 state 파일의 옛 버전 전부를 지운다(SST v4.17.0~). 현재 state·시크릿·암호화 키는
      // 건드리지 않고, 지우다 실패해도 배포는 실패하지 않는다. 되돌릴 수 있는 지점은 남은 스냅샷 N개다.
      state: { retention: 30 },
      providers: {
        aws: { region: 'ap-northeast-2' },
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
    process.env.npm_config_platform = 'linux';

    if ($app.stage === 'demo') {
      const shared = await import('./infra/demo-shared');
      const infra = shared.setup();
      const infraOnly = process.env.DEMO_INFRA_ONLY === 'true';
      if (!infraOnly) {
        const services = await import('./infra/demo-services');
        services.setup(infra);
      }
      return {
        dbHost: infra.db.host,
        adminUrl: infra.url('admin'),
        coreUrl: infra.url('core'),
        fileUrl: infra.url('file'),
        channelAdapterUrl: infra.url('channel-adapter'),
        analyticsUrl: infra.url('analytics'),
        notificationUrl: infra.url('notification'),
        infraOnly,
      };
    }

    const shared = await import('./infra/shared');
    const services = await import('./infra/services');
    const infra = shared.setup();
    services.setup(infra);
    return {
      dbHost: infra.db.host,
      medusaUrl: infra.url('medusa'),
      walletUrl: infra.url('wallet'),
      storefrontUrl: infra.url('www'),
      infraOnly: false,
    };
  },
});
