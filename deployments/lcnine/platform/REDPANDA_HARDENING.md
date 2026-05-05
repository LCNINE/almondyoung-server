# Redpanda 인프라 보강 사항

`platform/infra/shared.ts` + `redpanda.cloud-init.sh` 로 운영 중인 단일 노드 Redpanda(EC2 + EBS) 구조에서 인스턴스 라이프사이클을 건드릴 때 사고로 이어지기 쉬운 fragility 가 있다. 2026-05 사고(AMI 변종이 mostRecent 에서 minimal 로 바뀌어 SSM/docker 미설치 인스턴스로 교체됨)로 드러난 패턴을 근거로 정리한 보강 항목.

managed Kafka(MSK Serverless 등) 로 옮기는 선택지는 따로 검토했으며, dev floor ~$540/월 부담이 커서 당분간 self-managed 유지하기로 결정. 그 결정을 전제로 한 hardening 항목들이다.

## 권장 보강 항목

### 1. cloud-init 을 systemd oneshot service 로 분리 (우선순위: 높음)

**문제**
`redpanda.cloud-init.sh` 가 EC2 `userData` 로 첫 부팅에만 실행되며 `set -e` 로 한 단계라도 실패하면 즉시 종료. 재부팅이나 EBS 후속 attach 후에는 다시 안 돈다. 이번 사고에서 EBS 가 60초 안에 안 붙어서 `mkfs.xfs` 가 실패 → `dnf install`/systemd unit 작성 단계 미실행 → 인스턴스를 통째로 다시 만들어야 회복이라는 brittle 동선이 발생.

**방향**
1. `redpanda.cloud-init.sh` 의 EBS 마운트/Docker 설치/Redpanda systemd unit 작성 부분을 별도 스크립트(`redpanda-bootstrap.sh`)로 분리.
2. systemd oneshot service(`redpanda-bootstrap.service`)에서 그 스크립트를 실행. `After=network-online.target`, `Wants=cloud-final.service` 정도로 의존 잡고, **성공 마커 파일**(`/var/lib/redpanda/.bootstrapped`) 가드로 idempotent 보장.
3. EBS 마운트 단계는 `RequiresMountsFor=/var/lib/redpanda/data` 또는 `systemd-mount` 단위로 분리해서 fstab 와 별개로 systemd 가 직접 관리하면 race 가 깔끔히 풀린다.
4. `userData` 는 그 service 를 enable & start 하기만 하는 짧은 wrapper 로 줄임.

**효과**
- EBS 후속 attach 후 `systemctl restart redpanda-bootstrap` 만 하면 회복.
- 첫 부팅 실패해도 `journalctl -u redpanda-bootstrap` 으로 단계별 진단 용이.
- `set -e` 중간 종료가 인스턴스 폐기 사유가 되지 않음.

**작업량**: 중. 스크립트 분리 + systemd unit 2개. 기존 동작과의 차이가 있을 수 있어 dev 에서 선검증 필요.

### 2. EBS 교체를 snapshot 경유로 (우선순위: 중)

**문제**
현재 `aws.ec2.VolumeAttachment` 로 단일 영속 EBS 를 인스턴스에 직접 묶어둔다. 인스턴스 replace 가 발생하면 Pulumi 의 create-before-destroy 기본 순서 + 볼륨이 한 번에 한 호스트만 attach 되는 제약이 충돌해서 race 가 난다 (이번 사고의 직접 원인 중 하나). `stopInstanceBeforeDetaching: true` 로도 안 풀림.

**방향**
1. 데이터 볼륨을 인스턴스에 종속시키지 말고 **snapshot 을 진실의 출처**로 둠.
2. 정기 snapshot(예: AWS Backup 또는 `dlm` policy, 1h 주기) 로 RPO 1시간 수준 보장.
3. 인스턴스 replace 시: 새 인스턴스 부팅 → 최신 snapshot 으로부터 새 볼륨 생성 → attach. 옛 볼륨은 detach 후 보존(혹은 일정 기간 후 삭제). 볼륨이 fungible 해져서 race 자체가 없어짐.
4. 또는 이번 사고에서 한 것처럼 같은 볼륨을 옮기는 경우라도, Pulumi 가 attach/detach 를 직접 관리하는 대신 인스턴스 부팅 시 IMDS userdata 에서 "snapshot 기준 최신 볼륨"을 attach 하는 패턴(IAM 권한 추가 + `aws ec2 attach-volume`).

**효과**
- 인스턴스 교체가 안전하고 멱등적으로 됨.
- AMI mostRecent 류의 unintended replace 가 발생해도 데이터 손실/race 없이 흡수.
- 부수 효과로 백업 정책이 자연스럽게 자리잡음.

**작업량**: 중-대. snapshot 자동화 + 부팅 시 볼륨 생성/attach 로직 + IAM 정책. cloud-init 보강(1번)과 같이 진행하면 자연스럽다.

### 3. AMI 를 특정 ID 로 pin (우선순위: 즉시 가능)

**문제**
2026-05 사고의 root cause. `aws.ec2.getAmi({ mostRecent: true, filters: [...] })` 는 AWS 카탈로그 변동에 따라 desired state 가 silently mutate 된다. 이번엔 `al2023-ami-*-arm64` 필터가 minimal 변종까지 매치하다가 mostRecent 가 minimal 로 넘어가 SSM agent/docker 가 빠진 AMI 로 인스턴스가 교체되었다. 현재는 `al2023-ami-2023.*-kernel-6.1-arm64` 로 좁혀 두었지만 여전히 catalog 갱신 시 자동 replace 가능성이 남아있다.

**방향**
1. `aws.ec2.getAmi(...)` 호출을 제거하고 AMI ID 를 코드에 상수로 박는다.
2. 정책: 분기마다 또는 보안 패치 release note 모니터링 시점에만 사람이 의식적으로 갱신.
3. 갱신 시에는 1번 항목(systemd oneshot bootstrap)이 들어와 있어야 무서움 없이 가능.

**효과**
- AMI 카탈로그 변동이 인프라를 자동 수정하지 않음.
- 인스턴스 replace 사유가 코드 변경에 1:1 대응되어 변경 감지 가능.

**작업량**: 소. 한 줄 수정. 단 1번/2번 보강 후에 적용해야 안전 (replace 가 일어났을 때 회복할 수 있는 발판이 깔린 상태에서).

## 의존 / 권장 진행 순서

```
1. systemd oneshot bootstrap 분리      ← 안전망 마련
   ↓
2. snapshot 경유 EBS 교체 패턴 도입    ← race 제거
   ↓
3. AMI ID pin                          ← drift 제거
```

각각 별 PR 로 분리해서 진행하고, dev 에서 `sst deploy` 한 번씩 검증한 뒤 머지. 묶어서 한 번에 가면 어디서 깨졌는지 분간이 안 된다.

## 검토했지만 안 채택한 옵션

- **MSK Serverless** — cluster baseline ~$540/월 × 2 stage. 트래픽/SLO 가 본격적으로 올라오기 전에는 과투자.
- **Redpanda 3-노드 클러스터** — 비용 3배 + 운영 복잡도. 단일 노드 + outbox 흡수 전제가 깨지지 않는 한 불필요.
- **EFS 마운트** — Redpanda Seastar AIO 가 EFS 미지원 (shared.ts 코멘트 참고).

## 참고

- `platform/redpanda.cloud-init.sh` — 현행 bootstrap 스크립트
- `platform/infra/shared.ts` — Redpanda 인프라 정의 (EC2 + EBS + Cloud Map)
- 2026-05 사고 동선: minimal AMI 변종 자동 선택 → SSM agent 누락 → cloud-init 첫 부팅 EBS 미부착 실패 → 수동 복구
