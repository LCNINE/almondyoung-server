# AWS 리소스 비용 현황

계정 640168413575 · ap-northeast-2 · 기준일 **2026-07-07** (clip-live Spot 배포 검증 후) — clip-live Backend Fargate Spot 전환 · RDS t4g.small 다운사이즈 · ElastiCache→valkey 사이드카 · WAF→CloudFront Function · OpenSearch 제거 · 퍼블릭 IP 2개 제거 · UserService ARM64 전환이 **배포·검증 완료**된 현재 인벤토리 기준 집계

> 이전 스냅샷: [`aws-cost-report-2026-07-03.md`](./aws-cost-report-2026-07-03.md) ($522/월 baseline). 누적 절감 **$522 → $392/월 (−$130, −25%)**.
>
> 라이브 대시보드(막대차트·툴팁): 상황판 artifact — https://claude.ai/code/artifact/86001a1e-c604-4cb0-88b2-09356089df5e

| 월 예상 (세전) | VAT 10% 포함 | 원화 환산 (1,470원/$) |
|---|---|---|
| **$392/월** | **$431/월** | **약 63만원/월** |

## 항목별 월 비용

6월 청구(160만원)의 약 40% 수준.

| 항목 | 월액 | 비중 | 내용 |
|---|---:|---:|---|
| ECS Fargate | $85.76 | 21.9% | 태스크 9개 — clip-live Backend Fargate Spot 전환(on-demand $10.36 → ~$3.1) |
| RDS | $81.69 | 20.8% | PostgreSQL 3대 + 스토리지 — services t4g.small 다운사이즈 (RDS는 Spot 미지원) |
| ALB | $50.80 | 13.0% | 로드밸런서 3개 + LCU |
| 퍼블릭 IPv4 | $40.15 | 10.2% | 11개 × $3.65/월 (Redpanda·UserService 2개 제거) |
| S3 | $34.00 | 8.7% | 버킷 22개 · 증가 추세 |
| EC2 + EBS | $27.89 | 7.1% | NAT 4 + Redpanda 브로커(private) + 볼륨 56GB |
| ECR | $16.00 | 4.1% | 이미지 스토리지 · lifecycle 적용됨, 감소 예상 |
| 데이터 전송 | $13.00 | 3.3% | 리전 내·아웃바운드 |
| Lambda | $11.00 | 2.8% | 함수 17개 |
| CloudWatch | $10.00 | 2.6% | 로그 수집·보관 |
| DynamoDB | $8.00 | 2.0% | 온디맨드 |
| 기타 | $7.20 | 1.8% | Secrets 8개 · CloudFront(Function 포함) · SQS 등 |
| Route 53 | $6.40 | 1.6% | 존 12개 + 쿼리 |

세전 합계 **$391.89/월** · VAT 10% 포함 **$431.08 ≈ ₩633,688/월**

## 리소스 상세

단가는 전부 이 계정의 6~7월 청구 기록에서 실측한 값입니다 (usage type별 청구액 ÷ 사용량).

### ECS Fargate — 태스크 9개 · $85.76

실측 단가: x86 vCPU `$0.04656/h`·메모리 `$0.00511/GB·h` · ARM64 vCPU `$0.03725/h`·메모리 `$0.00409/GB·h` · Fargate Spot ≈ on-demand `−70%` (clip-live Backend에만 적용)

| 서비스 | 스펙 | 월액 |
|---|---|---:|
| ServicesBundleA `ARM64` — 경량 3앱 통합 (Analytics · ChannelAdapter · Membership) | 0.25 vCPU / 1 GB | $9.78 |
| ServicesBundleB `ARM64` — 경량 3앱 통합 (Notification · Search · UgcService) | 0.25 vCPU / 1 GB | $9.78 |
| 개별 서비스 3개 `ARM64` (Core · Wallet · FileService) | 0.25 vCPU / 0.5 GB × 3 (개당 $8.29) | $24.87 |
| Medusa `ARM64` `valkey 사이드카` — ElastiCache 대체, 같은 태스크에 valkey 동거, 메모리 1→2GB (+$3.0/월) | 0.5 vCPU / 2 GB | $19.57 |
| Observability | 0.25 vCPU / 0.5 GB · x86 | $10.36 |
| UserService `ARM64` (lcnine-auth-live) — x86 → ARM64 전환 (−$2.1/월) | 0.25 vCPU / 0.5 GB | $8.29 |
| Backend (clip-live) `Fargate Spot` — on-demand $10.36 → Spot (~70% 할인, −$7.3/월) · 스팟 중단 위험 감수 | 0.25 vCPU / 0.5 GB · x86 | $3.11 |

### RDS PostgreSQL — 3대 · $81.69

실측 단가: t4g.small `$0.051/h` · t4g.micro `$0.025/h` · gp3 `$0.131/GB·월`

| 인스턴스 | 스펙 | 월액 |
|---|---|---:|
| lcnine-services-live `다운사이즈` — t4g.medium → t4g.small (−$37.2/월). 메모리 압박 관측 시 원복 | db.t4g.small | $37.23 |
| lcnine-auth-live | db.t4g.micro | $18.25 |
| clip-live — RDS는 Spot 미지원, 변경 없음 | db.t4g.micro | $18.25 |
| 스토리지·백업 | gp3 20 GB × 3 | $7.96 |

### 로드밸런서 (ALB) — 3개 · $50.80

실측 단가: `$0.0225/h`/개 + LCU `$0.008/LCU·h` (트래픽분 소액)

| ALB | 용도 | 월액 |
|---|---|---:|
| SharedAlb | lcnine-services-live 공용 | $16.43 |
| IdpUserAlb | lcnine-auth-live (로그인) | $16.43 |
| BackendLoadBala | clip-live API | $16.43 |
| LCU (요청 처리량) | — | $1.51 |

### 퍼블릭 IPv4 — 11개 (13 → 11) · $40.15

실측 단가: `$0.005/h`/개 = 월 $3.65. Redpanda(private subnet 이동)·UserService(private subnet 전환) 2개 제거 — ENI 조회로 11개 실측 확인

| 보유 주체 | 수량 | 월액 |
|---|---:|---:|
| ALB 3개 × 2 AZ | 6 | $21.90 |
| NAT 인스턴스 (platform 2 + clip 2) | 4 | $14.60 |
| 퍼블릭 서브넷 태스크 (clip Backend) | 1 | $3.65 |

### EC2 인스턴스 — 5대 + EBS · $27.89

실측 단가: t4g.nano `$0.0052/h` · t4g.micro `$0.0104/h` · EBS gp3 `$0.0912/GB·월`

| 인스턴스 | 스펙 | 월액 |
|---|---|---:|
| fck-nat × 4 (platform-live 2 AZ + clip-live 2 AZ) | t4g.nano | $15.18 |
| lcnine-platform-live-redpanda (이벤트 브로커) — private subnet 이동, 퍼블릭 IP 제거 | t4g.micro | $7.59 |
| EBS 볼륨 6개 | gp3 56 GB | $5.11 |

### 사용량 기반 서비스 · $105.60

고정 자원이 아니라 사용량 과금 — 7월 초 실측 일평균 × 30.4일 (Route 53·Secrets는 월 정액 실측). WAF 행은 삭제됨 — CloudFront Function 대체분(요청 1M당 $0.10, 월 2M 무료)은 CloudFront 항목에 흡수.

| 서비스 | 내용 | 월 추정 |
|---|---|---:|
| S3 | 버킷 22개 — 6월($16) 대비 증가 추세 | $34.00 |
| ECR | 이미지 스토리지 — untagged 14일 lifecycle 적용됨, 수주 내 감소 예상 | $16.00 |
| 데이터 전송 | 리전 내 + 리전 간 아웃바운드 | $13.00 |
| Lambda | 함수 17개 (admin-web 등) | $11.00 |
| CloudWatch | 로그 수집·보관 | $10.00 |
| DynamoDB | 온디맨드 읽기/쓰기 | $8.00 |
| Route 53 | 호스팅 존 12개 × $0.50 + 쿼리 | $6.40 |
| Secrets Manager | 시크릿 8개 × $0.40 (Redis 프록시 시크릿 삭제) | $3.20 |
| CloudFront · SQS · 기타 | CloudFront Function(IP 차단) 포함 | $4.00 |

## 유의 사항

- **07-07 추가 절감 −$7.3/월 (clip-live Backend Spot):** clip-live ECS Backend 서비스를 Fargate Spot으로 전환 — ECS `capacityProviderStrategy = FARGATE_SPOT`(weight 1)로 실deploy 검증 완료(16:21). on-demand $10.36 → Spot 약 $3.1. clip의 RDS·ALB·NAT은 Spot 대상이 아니라 Backend Fargate만 전환 가능했음. **중단 위험:** 스팟 회수 시 단일 태스크가 재기동돼 짧은 다운 가능 — 무중단이 필요해지면 base 1 FARGATE 혼합 고려.
- **직전 라운드 절감 −$123/월 내역(07-05):** OpenSearch 도메인 −$42.3 · RDS t4g.small −$37.2 · WAF 제거 −$20 · ElastiCache→valkey −$17.5 · 퍼블릭 IP 2개 −$7.3 · UserService ARM64 −$2.1 · Redis 시크릿 −$0.4, 상쇄분 Medusa 메모리 1→2GB +$3.0.
- **모니터링 항목:** RDS t4g.small 메모리 압박(스왑·커넥션 실패)과 Medusa valkey 256MB 상한(noeviction — 가득 차면 쓰기 에러). 문제 시 각각 t4g.medium 원복 / maxmemory 상향으로 대응.
- **증가 추세 항목:** S3($16→$34/월)는 여전히 증가 중 — 버전·미완료 멀티파트·고아 버킷 정리 필요. ECR은 lifecycle 적용으로 감소 전환 예상.
- **남은 백로그 (~$119/월 추가 여지):** auth ALB 통합 −$24 · IdpDb 논리DB 통합 −$18 · Alloy 태스크 제거(OTLP 직접 전송) −$10 · FileService 번들 편입 −$7 · NAT 1대화 −$7 · clip-live 추가 정리(같은 플레이북) −$53 (Backend Spot −$7 반영 완료).

---

단가 출처: Cost Explorer usage type별 청구액 ÷ 사용량 (2026-06-01 ~ 07-04) · 월 730시간 기준 · 환율 1,470원/$ (6월 청구 실효환율) · 배포 검증 2026-07-05: 헬스체크 14개 엔드포인트 + RDS/ElastiCache/WAF/OpenSearch/ENI 인벤토리 실사 · 2026-07-07: clip-live Backend ECS capacityProviderStrategy = FARGATE_SPOT 확인 (Spot 단가는 on-demand −70% 추정 — 스팟 시세 변동·중단 가능성 있음)
