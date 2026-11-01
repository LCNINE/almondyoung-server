/// <reference path="../../.sst/platform/config.d.ts" />

// 테넌트 도메인마다 따로 세우는 CloudFront 배포. 근거는 비공개 메모(멀티테넌트 ADR 0008 교정·리서치 25 §7) —
// 레포의 docs/adr/0008 과는 다른 문서다.
//
// SST `domain.aliases` 를 쓰지 않는 이유: 별칭이 같은 배포·같은 인증서(SAN)에 들어가 테넌트 도메인 인증서와
// 공개 CT 로그에 우리 주소가 보인다. 그래서 칸마다 배포를 하나 직접 세우고, 인증서·별칭은 그 배포에만 붙인다.
//
// 칸의 배포는 SST 사이트 배포의 viewer-request 함수와 캐시 정책을 «참조»한다(복제가 아니다). 그 함수가
// 사이트 KV 에서 서버 함수 URL·버킷을 읽어 요청마다 원본을 고르고 `x-forwarded-host` 를 뷰어 Host 로 넣으므로,
// 빌드는 한 벌이고 배포 때 SST 가 KV 를 갱신하면 칸의 배포도 함께 따라간다. Next 는 테넌트 도메인을 본다.
//
// 이 구조가 기대는 SST 내부 계약(업그레이드 때 `.sst/platform/src/components/aws/ssr-site.ts` 의
// `createDistribution` 을 다시 볼 것):
//   ① standalone 사이트 배포는 placeholder 원본 하나 + 요청 함수가 원본을 고르는 구조다
//   ② `site.nodes.cdn.nodes.distribution` 의 기본 캐시 동작에 함수 연결·캐시 정책이 있다
//   ③ 사이트 `protection` 이 none 이다 — 아니면 함수 URL 권한이 SST 배포 하나에 묶여 칸이 403
//      (`scripts/deployment/tenant-slot-protection.spec.ts` 가 지킨다)

import { tenantDomainSlotsFor, tenantSlotSecretNames, type TenantSlotSite } from './tenant-domain-slots';

export function attachTenantDomainSlots(siteName: TenantSlotSite, site: sst.aws.Nextjs) {
  const slots = tenantDomainSlotsFor($app.stage);
  if (slots.length === 0) return;

  const cdn = site.nodes.cdn;
  const server = site.nodes.server;
  if (!cdn || !server) {
    throw new Error(`${siteName}: 테넌트 칸은 자기 CloudFront 배포를 가진 사이트(domain 있음, router 없음)에만 붙는다`);
  }
  const main = cdn.nodes.distribution;
  const mainBehavior = main.defaultCacheBehavior;
  // Next BUILD_ID 가 서버 번들에 들어가므로 SST 가 자기 배포를 무효화하는 배포에선 이 값도 바뀐다.
  // 이미지 최적화 함수는 nodes 에 없어 트리거에 못 넣는다 — 그것만 바뀌는 배포는 칸을 무효화하지 않는다.
  const serverCodeSha256 = server.apply((s) => s.nodes.function.codeSha256);

  for (const slot of slots) {
    const secretNames = tenantSlotSecretNames(siteName, slot);
    const domain = new sst.Secret(secretNames.domain);
    const certArn = new sst.Secret(secretNames.certArn); // us-east-1 ACM, 테넌트 이름만 담은 인증서
    const zoneId = new sst.Secret(secretNames.zoneId);
    const resourcePrefix = `${siteName}TenantSlot${slot}`;

    // waitForDeployment 는 기본값(true)으로 둔다 — 배포가 끝났으면 테넌트 도메인이 이미 서는 것이 낫다. 바뀌는 일은 드물다.
    const distribution = new aws.cloudfront.Distribution(resourcePrefix, {
      comment: `${siteName} tenant slot ${slot}`,
      enabled: true,
      // 사이트 배포를 따른다. 켜지면 AAAA 레코드도 더해야 IPv6 로 닿는다(지금 둘 다 꺼져 있다).
      isIpv6Enabled: main.isIpv6Enabled.apply((v) => v ?? false),
      aliases: [domain.value],
      viewerCertificate: {
        acmCertificateArn: certArn.value,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      },
      restrictions: { geoRestriction: { restrictionType: 'none' } },
      // SST standalone 배포와 같은 가짜 원본 — 실제 원본은 공유 요청 함수가 고른다.
      origins: [
        {
          originId: 'default',
          domainName: 'placeholder.sst.dev',
          customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: 'http-only',
            originReadTimeout: 20,
            originSslProtocols: ['TLSv1.2'],
          },
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: 'default',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
        cachedMethods: ['GET', 'HEAD'],
        compress: true,
        cachePolicyId: mainBehavior.apply((b) => {
          if (!b.cachePolicyId) throw new Error(`${siteName}: 사이트 배포에 캐시 정책이 없다 — SST 배포 구조가 바뀌었다`);
          return b.cachePolicyId;
        }),
        // CloudFront Managed-AllViewerExceptHostHeader — SST 사이트 배포와 같은 값
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
        // 통째로 복사한다 — SST 가 viewer-response 함수를 더하면 칸에도 같이 걸린다.
        functionAssociations: mainBehavior.apply((b) => b.functionAssociations ?? []),
      },
    });

    new aws.route53.Record(`${resourcePrefix}Record`, {
      zoneId: zoneId.value,
      name: domain.value,
      type: 'A',
      aliases: [{ name: distribution.domainName, zoneId: distribution.hostedZoneId, evaluateTargetHealth: false }],
    });

    // SST 는 자기 배포만 무효화한다. 칸의 배포는 서버 함수가 바뀐 배포마다 여기서 `/*` 를 무효화한다(비공개 멀티테넌트 티켓 03 실측).
    // - 명령 안의 aws CLI 는 자기 기본 체인을 쓴다. sst 는 자격증명을 `SST_AWS_*`(배포 시작 때 찍은 15분 키)로만
    //   넘겨서, 그걸 쓰면 긴 배포 끝에서 만료될 수 있다. `providers.aws` 에 profile·assumeRoles 를 넣으면
    //   이 명령에도 같은 프로필을 넘겨야 같은 자격증명이 된다.
    // - `codeSha256` 은 apply 전 미지값이라 `sst diff` 에는 이 교체가 안 보인다. 확인은 list-invalidations 로.
    // - delete 가 없어 칸을 빼거나 `sst remove` 할 때는 아무것도 돌지 않는다.
    new command.local.Command(
      `${resourcePrefix}Invalidation`,
      {
        create: $interpolate`aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths '/*' --query Invalidation.Id --output text`,
        triggers: [serverCodeSha256],
      },
      // 사이트 컴포넌트(자산 업로드·KV 갱신) 뒤에 돌 것으로 기대한다. SST 자기 무효화는 apply 안에서 늦게 등록돼
      // 컴포넌트 dependsOn 이 그것까지 덮는지는 재지 않았다 — 칸을 켠 첫 배포의 sst 출력 순서로 확인한다.
      { dependsOn: [site, distribution] },
    );
  }
}
