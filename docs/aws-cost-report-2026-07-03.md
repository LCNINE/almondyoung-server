# AWS 리소스 비용 현황

계정 640168413575 · ap-northeast-2 · 기준일 **2026-07-03** — dev 스테이지 제거·arm64 전환·Redpanda Console 제거 반영 후 현재 배포된 리소스만 집계

| 월 예상 (세전) | VAT 10% 포함 | 원화 환산 (1,470원/$) |
|---|---|---|
| **$569/월** | **$626/월** | **약 92만원/월** |

## 항목별 월 비용

6월 청구(160만원) 대비 약 43% 수준.

| 항목 | 월액 | 비중 | 내용 |
|---|---:|---:|---|
| ECS Fargate | $138.85 | 24.4% | 태스크 14개 (표준 9 + Medusa 2 + x86 3) |
| RDS | $118.92 | 20.9% | PostgreSQL 3대 + 스토리지 |
| ALB | $50.80 | 8.9% | 로드밸런서 3개 + LCU |
| 퍼블릭 IPv4 | $47.45 | 8.3% | 13개 × $3.65/월 |
| OpenSearch | $42.27 | 7.4% | t3.small 1노드 + 10GB |
| S3 | $34.00 | 6.0% | 버킷 22개 · 증가 추세 |
| EC2 + EBS | $27.89 | 4.9% | NAT 4 + Redpanda(잔존) + 볼륨 56GB |
| WAF | $20.00 | 3.5% | WebACL + 규칙 + 요청 |
| ElastiCache | $17.52 | 3.1% | Redis t4g.micro 1노드 |
| ECR | $16.00 | 2.8% | 이미지 스토리지 · lifecycle 미설정 |
| 데이터 전송 | $13.00 | 2.3% | 리전 내·아웃바운드 |
| Lambda | $11.00 | 1.9% | 함수 17개 |
| CloudWatch | $10.00 | 1.8% | 로그 수집·보관 |
| DynamoDB | $8.00 | 1.4% | 온디맨드 |
| Route 53 | $6.40 | 1.1% | 존 12개 + 쿼리 |
| 기타 | $7.10 | 1.2% | Secrets · CloudFront · SQS 등 |

세전 합계 **$569.20/월** · VAT 10% 포함 **$626.12 ≈ ₩920,401/월**

## 리소스 상세

단가는 전부 이 계정의 6~7월 청구 기록에서 실측한 값입니다 (usage type별 청구액 ÷ 사용량).

### ECS Fargate — 태스크 14개 · $138.85

실측 단가(x86): vCPU `$0.04656/h` · 메모리 `$0.00511/GB·h` — ARM64는 전환 직후라 청구 기록에 아직 없어 x86 실측가 × 0.8(AWS 공시 할인) 적용

| 서비스 | 스펙 | 월액 |
|---|---|---:|
| 표준 서비스 9개 `ARM64` (Core · ChannelAdapter · Search · Wallet · Membership · Notification · FileService · UgcService · Analytics) | 0.25 vCPU / 0.5 GB × 9 (개당 $8.29) | $74.61 |
| Medusa × 2 `ARM64` | 0.5 vCPU / 1 GB (개당 $16.58) | $33.16 |
| Observability | 0.25 vCPU / 0.5 GB · x86 | $10.36 |
| UserService (lcnine-auth-live) | 0.25 vCPU / 0.5 GB · x86 | $10.36 |
| Backend (clip-live) | 0.25 vCPU / 0.5 GB · x86 | $10.36 |

### RDS PostgreSQL — 3대 · $118.92

실측 단가: t4g.medium `$0.102/h` · t4g.micro `$0.025/h` · gp3 `$0.131/GB·월`

| 인스턴스 | 스펙 | 월액 |
|---|---|---:|
| lcnine-services-live | db.t4g.medium | $74.46 |
| lcnine-auth-live | db.t4g.micro | $18.25 |
| clip-live | db.t4g.micro | $18.25 |
| 스토리지·백업 | gp3 20 GB × 3 | $7.96 |

### 로드밸런서 (ALB) — 3개 · $50.80

실측 단가: `$0.0225/h`/개 + LCU `$0.008/LCU·h` (트래픽분 소액)

| ALB | 용도 | 월액 |
|---|---|---:|
| SharedAlb | lcnine-services-live 공용 | $16.43 |
| IdpUserAlb | lcnine-auth-live (로그인) | $16.43 |
| BackendLoadBala | clip-live API | $16.43 |
| LCU (요청 처리량) | — | $1.51 |

### 퍼블릭 IPv4 — 13개 · $47.45

실측 단가: `$0.005/h`/개 = 월 $3.65. 존재만으로 과금되는 항목

| 보유 주체 | 수량 | 월액 |
|---|---:|---:|
| ALB 3개 × 2 AZ | 6 | $21.90 |
| NAT 인스턴스 (platform 2 + clip 2) | 4 | $14.60 |
| Redpanda EC2 (이벤트 브로커) | 1 | $3.65 |
| 퍼블릭 서브넷 태스크 (UserService · clip Backend) | 2 | $7.30 |

### OpenSearch — 1도메인 · $42.27

실측 단가: t3.small.search `$0.056/h` · 스토리지 gp3 `$0.139/GB·월`

| 리소스 | 스펙 | 월액 |
|---|---|---:|
| li-opensearchdomain (live 상품 검색) | t3.small × 1노드 | $40.88 |
| 스토리지 | gp3 10 GB | $1.39 |

### EC2 인스턴스 — 5대 + EBS · $27.89

실측 단가: t4g.nano `$0.0052/h` · t4g.micro `$0.0104/h` · EBS gp3 `$0.0912/GB·월`

| 인스턴스 | 스펙 | 월액 |
|---|---|---:|
| fck-nat × 4 (platform-live 2 AZ + clip-live 2 AZ) | t4g.nano | $15.18 |
| lcnine-platform-live-redpanda (이벤트 브로커) | t4g.micro | $7.59 |
| EBS 볼륨 6개 | gp3 56 GB | $5.11 |

### ElastiCache Redis — 1노드 · $17.52

실측 단가: cache.t4g.micro `$0.024/h`

| 리소스 | 스펙 | 월액 |
|---|---|---:|
| lcnine-services-live Redis | cache.t4g.micro × 1 | $17.52 |

### 사용량 기반 서비스 · $125.50

고정 자원이 아니라 사용량 과금 — 7/1~7/2 실측 일평균 × 30.4일 (Route 53·Secrets는 월 정액 실측)

| 서비스 | 내용 | 월 추정 |
|---|---|---:|
| S3 | 버킷 22개 — 6월($16) 대비 증가 추세 | $34.00 |
| WAF | WebACL + 규칙 + 요청 (Storefront) | $20.00 |
| ECR | 컨테이너 이미지 스토리지 (lifecycle 미설정) | $16.00 |
| 데이터 전송 | 리전 내 + 리전 간 아웃바운드 | $13.00 |
| Lambda | 함수 17개 (admin-web 등) | $11.00 |
| CloudWatch | 로그 수집·보관 | $10.00 |
| DynamoDB | 온디맨드 읽기/쓰기 | $8.00 |
| Route 53 | 호스팅 존 12개 × $0.50 + 쿼리 | $6.40 |
| Secrets Manager | 시크릿 9개 × $0.40 | $3.60 |
| CloudFront · SQS · 기타 | — | $3.50 |

## 유의 사항

- **ARM64 단가는 추정 포함:** 전환이 어제오늘 사이라 ARM 사용분이 청구 기록에 아직 잡히지 않았습니다. x86 실측 단가 × 0.8(AWS 공시 할인율)로 계산했으며, 다음 주 청구 데이터로 검증 가능합니다.
- **집계 지연:** Cost Explorer는 24~48시간 늦습니다. 고정 자원은 현재 인벤토리 × 실측 단가로, 사용량 항목은 최근 실측 일평균으로 계산해 지연의 영향을 제거했습니다.
- **증가 추세 항목:** S3($16→$34/월)·WAF($10→$20/월)·ECR은 6월 대비 늘고 있습니다. ECR은 lifecycle 정책, S3는 버전·로그 정리로 억제 가능합니다.

---

단가 출처: Cost Explorer usage type별 청구액 ÷ 사용량 (2026-06-01 ~ 07-02) · 월 730시간 기준 · 환율 1,470원/$ (6월 청구 실효환율)
