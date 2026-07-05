/// <reference path="../../../../.sst/platform/config.d.ts" />

// lcnine 공용 플랫폼: VPC + Kafka(Redpanda 1-노드).
// 이 VPC와 Cloud Map 네임스페이스를 auth/services 앱이 Vpc.get()으로 공유한다.
// 단일 노드 Redpanda는 비용 최적화 선택. 인스턴스/AZ 장애 시 짧은 다운타임이 있으나
// 애플리케이션 레이어의 transactional outbox가 재시도를 흡수한다.

import * as fs from "node:fs";
import * as path from "node:path";

export function setup() {
  // "live" 외의 모든 stage는 비운영으로 취급 (도메인 .dev. 접두사 등).
  const isDev = $app.stage !== "live";

  // ─── VPC (auth/services가 Vpc.get(id)로 공유) ───
  // bastion은 dev/live 모두 상시 ON: IdP DB 등 VPC 내부 리소스에
  // 시딩/점검 목적으로 `sst tunnel` 접근이 필요. t4g.nano 1대 비용(월 ~$3).
  const vpc = new sst.aws.Vpc("PlatformVpc", {
    bastion: true,
    // dev 효성CMS 테스트 API는 등록된 outbound IP만 접근 가능하므로 SST가 관리하는 NAT EIP를 사용한다.
    // "ec2"는 fck-nat 기반으로 managed NAT Gateway보다 저렴해 dev 테스트 목적에 적합하다.
    nat: "ec2",
  });

  // ─── Redpanda 1-노드 EC2 + EBS 영속 ───
  // Fargate/EFS는 Seastar AIO 미지원이라 불가 → EC2(t4g.micro) + EBS(gp3) 선택.
  // 인스턴스 교체 시에도 EBS 재부착으로 데이터 유지. Cloud Map A record로 DNS 부여.
  // AMI ID 고정: mostRecent 동적 조회는 AWS 카탈로그 변동 시 인스턴스를 자동 교체하는 사고를
  // AMI 갱신이 필요하면 아래 ID를 변경할 것.
  // 현재: al2023-ami-2023.*-kernel-6.1-arm64, ap-northeast-2, 2026-05 기준
  const redpandaAmiId = "ami-05b5c26974028499f";

  const redpandaRole = new aws.iam.Role("RedpandaRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "ec2.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    }),
  });
  new aws.iam.RolePolicyAttachment("RedpandaRoleSsm", {
    role: redpandaRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });
  const redpandaInstanceProfile = new aws.iam.InstanceProfile("RedpandaInstanceProfile", {
    role: redpandaRole.name,
  });

  // private subnet 배치 — Docker Hub pull 은 NAT(fck-nat EIP) 경유. 퍼블릭 IPv4 는 존재만으로
  // 월 $3.65 과금이라 제거 (원래 public subnet 이었던 유일한 이유가 이미지 pull). EBS는 AZ
  // 귀속이라 인스턴스도 동일 AZ 고정 — privateSubnets[0] 과 publicSubnets[0] 은 같은 첫 번째
  // AZ 라 기존 EBS 볼륨 위치와 일치. 배포 plan 에서 RedpandaData(EBS) 가 replace 로 뜨면
  // AZ 불일치이므로 즉시 중단할 것 (데이터 유실).
  const redpandaSubnetId = vpc.nodes.privateSubnets.apply((s) => s[0].id);
  const redpandaAz = vpc.nodes.privateSubnets.apply((s) => s[0].availabilityZone);

  const redpandaEbs = new aws.ebs.Volume("RedpandaData", {
    availabilityZone: redpandaAz,
    size: 10,
    type: "gp3",
    encrypted: true,
  });

  // Cloud Map DNS. 같은 VPC에 붙은 컨슈머는 DNS 해석만으로 브로커에 접속 가능.
  const redpandaDiscovery = new aws.servicediscovery.Service("RedpandaDiscovery", {
    name: `Redpanda.${$app.stage}.${$app.name}`,
    namespaceId: vpc.nodes.cloudmapNamespace.id,
    dnsConfig: {
      namespaceId: vpc.nodes.cloudmapNamespace.id,
      dnsRecords: [{ ttl: 60, type: "A" }],
      routingPolicy: "MULTIVALUE",
    },
  });
  const redpandaDns = `Redpanda.${$app.stage}.${$app.name}.sst`;
  const kafkaBrokers = `${redpandaDns}:9092`;

  // cloud-init 스크립트. SST는 services.ts를 .sst/platform에 복사한 뒤 실행하므로
  // $cli.paths.root 기준으로 파일을 읽어야 한다.
  const redpandaUserData = fs
    .readFileSync(path.join($cli.paths.root, "redpanda.cloud-init.sh"), "utf8")
    .replace(/__REDPANDA_ADVERTISE_DNS__/g, redpandaDns);

  const redpandaInstance = new aws.ec2.Instance(
    "Redpanda",
    {
      ami: redpandaAmiId,
      instanceType: "t4g.micro",
      subnetId: redpandaSubnetId,
      availabilityZone: redpandaAz,
      vpcSecurityGroupIds: vpc.securityGroups,
      associatePublicIpAddress: false,
      iamInstanceProfile: redpandaInstanceProfile.name,
      userData: redpandaUserData,
      // AL2023 AMI 스냅샷이 30GB라 그 이하로 못 줄임.
      rootBlockDevice: { volumeSize: 30, volumeType: "gp3", encrypted: true },
      tags: { Name: `${$app.name}-${$app.stage}-redpanda` },
    },
    {
      // subnet 변경은 인스턴스 replace. 기본(create-before-delete)이면 EBS 가 옛 인스턴스에
      // 붙어 있어 새 인스턴스의 VolumeAttachment 생성이 실패한다. 옛 것을 먼저 내려(EBS 자동
      // 분리) 새 것을 만드는 순서로 강제 — 그 사이 Redpanda 다운타임은 outbox 재시도가 흡수.
      deleteBeforeReplace: true,
    },
  );

  new aws.ec2.VolumeAttachment("RedpandaDataAttach", {
    deviceName: "/dev/sdf",
    volumeId: redpandaEbs.id,
    instanceId: redpandaInstance.id,
    stopInstanceBeforeDetaching: true,
  });

  new aws.servicediscovery.Instance("RedpandaDiscoveryInstance", {
    instanceId: "redpanda-0",
    serviceId: redpandaDiscovery.id,
    attributes: {
      AWS_INSTANCE_IPV4: redpandaInstance.privateIp,
    },
  });

  // ─── 공용 ECR(sst-asset) 이미지 정리 정책 ───
  // sst-asset 은 부트스트랩이 만든 계정/리전 공용 리포로, 모든 SST 앱·스테이지의 컨테이너
  // 이미지가 여기로 push 된다. 매 배포마다 직전 이미지가 untagged 로 남아 저장 비용이 무한
  // 증가하므로 "untagged 14일 경과분 자동 만료" lifecycle 을 건다 (현재 참조 중인 tagged 는 보존).
  // 공용 리소스라 dev/live 가 동시에 관리하면 서로 덮어써 충돌 → live 스테이지에서만 소유한다.
  if (!isDev) {
    new aws.ecr.LifecyclePolicy("SstAssetLifecycle", {
      repository: "sst-asset",
      policy: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: "Expire untagged images older than 14 days",
            selection: {
              tagStatus: "untagged",
              countType: "sinceImagePushed",
              countUnit: "days",
              countNumber: 14,
            },
            action: { type: "expire" },
          },
        ],
      }),
    });
  }

  return {
    isDev,
    vpc,
    kafkaBrokers,
  };
}

export type PlatformInfra = ReturnType<typeof setup>;
