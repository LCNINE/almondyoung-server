# 런북 — OTel 자격증명 노출 대응 (2026-08-14)

코드 수정(`fix/medusa-otel-credential-redaction`)은 **앞으로의 유출**만 막는다.
이미 Grafana Cloud 에 적재된 값은 이 문서의 절차로 처리한다. **실행은 사람이 한다.**

배경과 원인은 `docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md` 참조.

## 방어선 개요

**코드로 막는 범위 (Tasks 1-6 완료):**

1. **Medusa (주 방어선):** OTel exporter 를 `RedactingSpanExporter`/`RedactingLogExporter` 래퍼로 감싼다. HTTP span 에 스프레드된 요청 헤더(`authorization` 등)와 DB 접속 문자열의 비밀번호를 내보내기 직전에 마스킹.

2. **Alloy (2 차 방어선):** OTTL 변환으로 점 없는 attribute (원시 헤더) 삭제 + `http.request/response.header.*` 명시 차단 + DB 접속 문자열 마스킹. 패턴: `replace_pattern(attributes["db.connection_string"], "://([^:/?#\\s@]*):([^\\s/?#]*)@", "://${1}:[REDACTED]@")`

**코드로 덮이지 않는 범위:**

- **Next.js 앱들 (admin-web, wallet-web, storefront, auth-web):** VPC 밖 Lambda 라 Alloy 를 거치지 않는다. 이들은 `@vercel/otel` 로 계측되며 요청 헤더를 span 에 담지 않아 현재는 안전하다. 하지만 향후 HTTP 계측 추가 시 동일한 redaction 래퍼를 적용할 것.
- **user-service:** `deployments/lcnine/auth/infra/services.ts:103-105` 가 `OTEL_EXPORTER_OTLP_ENDPOINT`/`GRAFANA_OTLP_INSTANCE_ID`/`GRAFANA_OTLP_TOKEN` 을 주입해 Grafana Cloud OTLP 게이트웨이로 **직접** 전송한다 (auth→services 순환 의존을 피하려고 Next.js 앱과 같은 경로를 쓴다 — 소스: 해당 파일의 `─── Observability ───` 주석). NestJS 서비스라 `getNodeAutoInstrumentations` 기본값을 쓰므로 헤더 스프레드 위험은 낮지만, `DATABASE_URL: dbUrl('user_service')` 가 마스터 비밀번호를 담은 접속 문자열이고 이 경로엔 앱 레벨 redaction 도 Alloy 도 없다 — **이 브랜치가 덮지 못하는 잔여 노출 지점이다.** **중요:** 이 `dbUrl` 은 아래 §1 표의 services 앱 공유 `Db` 가 **아니라** auth 앱이 별도 소유한 `IdpDb`(`deployments/lcnine/auth/infra/shared.ts:40`)의 자체 마스터 비밀번호다 — 오늘은 `user_service` 하나만 이 인스턴스를 쓰지만 비밀번호 값 자체는 services `Db` 와 다르므로, §1 의 회전 절차를 services 쪽에만 실행하면 user-service/`IdpDb` 쪽 노출은 그대로 남는다. 완화 근거(확인됨): 루트 `package-lock.json`(user-service 가 쓰는 의존성 트리)이 `@opentelemetry/instrumentation-pg@0.65.0` 을 고정하고 있어 접속 문자열이 계측 상류에서 마스킹된다 — 오늘 시점 위험은 낮지만 "덮인다"는 뜻은 아니다. 회전 범위 판단 시 `IdpDb` 도 별도 항목으로 포함해서 검토할 것.

---

## 0. 선행 확인

### 0-1. Loki 에도 적재됐는지 확인

설계 시점에 **미확인**으로 남은 항목이다. 조회 자격증명이 필요하다:

```bash
cd deployments/lcnine/services
# 필요한 자격증명 추출
GRAFANA_TOKEN=$(npx sst secret list --stage live | sed -n 's/^GrafanaCloudApiToken=//p')
LOKI_ENDPOINT=$(npx sst secret list --stage live | sed -n 's/^GrafanaCloudLokiOtlpEndpoint=//p')
LOKI_USERNAME=$(npx sst secret list --stage live | sed -n 's/^GrafanaCloudLokiUsername=//p')
# 엔드포인트에서 호스트 추출 (예: https://logs-prod-…/otlp → logs-prod-…)
LOKI_HOST=$(echo "$LOKI_ENDPOINT" | sed 's|^.*https://||; s|/.*||')

curl -s -u "${LOKI_USERNAME}:${GRAFANA_TOKEN}" -G \
  "https://${LOKI_HOST}/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="medusa"} |= "postgresql://"' \
  -d "start=$(date -d '7 days ago' +%s)000000000" \
  -d "end=$(date +%s)000000000" \
  -d limit=5
```

결과가 비어 있지 않으면 로그에도 노출된 것이다. **출력에 실제 비밀번호가 포함되므로
터미널 스크롤백과 공유에 주의한다.**

### 0-2. Retention 확인

Grafana Cloud 대시보드(grafana.com) → 스택 선택 → 좌측 메뉴 **Data Configuration** → **Retention** 에서:
- **Tempo** retention 값 확인 (기본 2 주, 커스텀은 플랜별 상이)
- **Loki** retention 값 확인 (기본 30 일, 커스텀은 플랜별 상이)

아래 3 절의 "만료 대기" 기간이 여기서 정해진다.

**확인 필요:** Grafana Cloud 플랜별 기본 retention 값 (공개 정보는 2 주/30 일이나 실제 설정 확인)

---

## 1. DB 마스터 비밀번호 회전

### 영향 범위

**전부다.** 다음 서비스들이 `deployments/lcnine/services/infra/shared.ts` 의 단일 `Postgres('Db', ...)` 인스턴스에서 자동 생성된 마스터 비밀번호를 공유한다:

- **Analytics** → `analytics` 논리 DB
- **ChannelAdapter** → `channel_adapter` 논리 DB
- **Membership** → `membership` 논리 DB
- **Notification** → `notification` 논리 DB
- **UgcService** → `ugc` 논리 DB
- **Core** → `core` 논리 DB (WMS + PIM 통합 백엔드)
- **Wallet** → `wallet` 논리 DB
- **FileService** → `file_service` 논리 DB
- **Medusa** → `medusa` 논리 DB (추가로 `ugc` 읽음)

### 핵심 주의사항

RDS 마스터 비밀번호 변경은 **즉시 적용되지만 기존 커넥션은 살아남고 신규 커넥션만 실패한다.**
따라서 "변경 → 전 서비스 강제 재배포/재시작" 이 한 세트다. **재시작을 빠뜨리면 커넥션 풀이 재연결을 시도하는 시점에 서비스가 산발적으로 죽는다.**

**확인 필요 — 회전 범위를 좁힐 수도 있는 사실:** 이 사고는 사람이 Grafana Cloud Tempo 에서
평문 비밀번호를 **직접 관측해서** 확정됐다 — 그 관측 자체는 부정할 수 없다. 다만 전 서비스
롤링 재시작을 포함하는 이 절차를 실행하기 **전에**, 그 노출이 지금 배포된 이미지에서도
재현되는지 확인할 가치가 있다: `apps/medusa/package-lock.json` 과 `apps/medusa/yarn.lock`
둘 다 `@opentelemetry/instrumentation-pg@0.52.0` 을 고정하고 있고, 이 버전은 이미 접속
문자열을 상류에서 마스킹한다(반면 루트 `package-lock.json` 은 `@opentelemetry/instrumentation-pg@0.65.0`
을 고정 — 버전이 다르다). 즉 **관측된 노출을 만든 배포 이미지가 이 0.52.0 고정 이전
시점의 빌드일 가능성이 있다** — 그렇다면 회전의 범위(어느 시점까지의 이미지가 취약했는지)가
이 문서가 가정하는 것보다 좁을 수 있다. 실행 전 이미지 빌드 시점과 그 안의
`instrumentation-pg` 실제 버전을 확인할 것. **이 확인이 "회전이 불필요하다"는 뜻은 아니다** —
노출은 실측됐고, 확인 결과가 나올 때까지는 아래 절차를 그대로 전제로 진행한다.

### 절차

1. **유지보수 창 잡기**
   - 전 서비스 재시작이 필요하므로 트래픽이 낮은 시간대 선택 (권장: 새벽 2~4 시)
   - 대략 30~60 분 소요 (배포 시간 + 헬스체크)

2. **새 비밀번호를 SST Secret 으로 관리하도록 전환**
   - 현재: `sst.aws.Postgres('Db', { vpc })` 가 자동 생성 (명시 비밀번호 없음)
   - 변경: 새 비밀번호를 생성해 SST Secret 으로 등록 후, `Postgres` 정의에 `username`/`password` 를 명시
     (`sst.aws.Postgres` 의 실제 프로퍼티명 — `masterUsername`/`masterPassword` 가 아니다.
     `deployments/lcnine/services/infra/shared.ts:68` 의 `dbUrl()` 이 `db.username`/`db.password`
     를 읽는 것으로 확인됨. `masterUsername`/`masterPassword` 는 AWS RDS/CDK 쪽 명명이라
     혼동하기 쉽지만 SST v4 API 는 다르다 — 틀린 이름을 쓰면 이 단계에서 타입 에러로 막힌다.)
   - 이는 코드 PR 이다 (SST/Pulumi infra 코드 변경 — 이 저장소는 SST v4 로 Pulumi 기반이다.
     CloudFormation/Terraform 이 아니다)

   ```bash
   # 새 비밀번호 생성 (예시)
   NEW_PASSWORD=$(openssl rand -base64 32)
   echo "보관할 비밀번호: $NEW_PASSWORD"
   
   # Secret 등록
   cd deployments/lcnine/services
   npx sst secret set DbMasterPassword "$NEW_PASSWORD" --stage live
   ```

3. **RDS 비밀번호 변경 배포**
   ```bash
   cd deployments/lcnine/services
   sst deploy --stage live
   ```
   배포 진행 중 `sst.aws.Postgres` 리소스의 `password` 가 변경되면 RDS 인스턴스의 비밀번호가 즉시 갱신된다.
   **확인 필요:** 이 인스턴스가 실수로 삭제/교체되지 않도록 보호되는 메커니즘 — SST v4(`4.6.10` 고정)는
   Pulumi 기반이라 CloudFormation 스택도 `DeletionPolicy` 도 존재하지 않는다(이전 버전의 이 런북이
   그렇게 서술했으나 틀렸다). 실제 보호는 SST/Pulumi 프로바이더가 다루는 리소스 옵션(예: `protect`)이나
   `deployments/lcnine/CLAUDE.md` 가 언급하는 `removal: retain`(stage 가 `live`일 때 적용) 쪽일 가능성이
   높지만, 이 단계를 실행하기 전에 실제 SST 리소스 정의와 Pulumi 상태를 직접 확인해 어떤 보호가
   걸려 있는지(또는 없는지) 검증할 것.

4. **전 서비스 강제 재배포**
   ```bash
   # 방법 1: 모든 ECS 서비스 재배포 (가장 신뢰할 수 있음)
   # 클러스터 ARN 동적 발견 (랜덤 접미사 때문에 하드코딩 불가)
   CLUSTER_ARN=$(aws ecs list-clusters --query "clusterArns[?contains(@,'lcnine-services-live-ClusterCluster')]|[0]" --region ap-northeast-2 --output text)
   # 모든 ECS 서비스에 명령 반복: ServicesBundleA, ServicesBundleB, Core, Wallet, FileService, Medusa, 등
   aws ecs update-service --cluster "$CLUSTER_ARN" --service <SERVICE_NAME> --force-new-deployment --region ap-northeast-2
   
   # 방법 2: SST 재배포 (Alloy 등 다른 리소스도 함께, 가장 단순)
   cd deployments/lcnine/services
   sst deploy --stage live
   ```

5. **헬스체크 확인**
   ```bash
   # ALB 타깃 그룹 상태 (AWS 콘솔 또는 CLI)
   aws elbv2 describe-target-health \
     --target-group-arn <TARGET_GROUP_ARN> --region ap-northeast-2
   
   # 각 서비스 헬스 엔드포인트 (예)
   curl -s https://core.almondyoung.com/health | jq .
   curl -s https://analytics.almondyoung.com/health | jq .
   # ... 나머지 서비스
   ```

### 롤백

비밀번호를 되돌리는 것보다 **전방 수정이 안전하다** — 이미 새 비밀번호로 배포되었으므로 되돌리면 다시 모든 서비스가 재시작 필요.

4 단계에서 일부 서비스가 실패하면:
- 실패한 서비스만 재배포: `sst deploy --stage live` 를 다시 돌리거나 `aws ecs update-service --force-new-deployment` 로 해당 서비스만
- 로그 확인: `aws logs tail /ecs/<service-name> --follow`

---

## 2. Medusa 토큰 회전

노출 창 = **Tempo retention 기간 전체** (0-2 에서 확인한 값). 그 기간 안에 Medusa `/auth/*`, `/admin/*`, `/store/customers/me` 를 통과한 admin/store 토큰이 노출되었을 가능성이 있다.

### 회전 대상

- **admin 토큰** (유효 기간: 브라우저 세션, 일반적 1~24 시간)
  - 영향 범위: 운영자 계정 전수
  - 회전: 로그아웃 + 재로그인 (자동 재발급)
  - 절차: Admin-web 에서 로그아웃 → 재로그인

- **store 토큰** (고객 세션)
  - 영향 범위: storefront 방문자 전수
  - 회전: 자동 (Medusa 세션 갱신 기본값)
  - 선택 조치: 필요시 세션 저장소(valkey) 초기화로 강제 로그아웃
    ```bash
    # Medusa 태스크 접속 (ECS Exec, Medusa 서비스의 valkey 사이드카)
    # 클러스터 ARN 동적 발견 (랜덤 접미사 때문에 하드코딩 불가)
    CLUSTER_ARN=$(aws ecs list-clusters --query "clusterArns[?contains(@,'lcnine-services-live-ClusterCluster')]|[0]" --region ap-northeast-2 --output text)
    # Medusa 태스크 찾기 (service-name 으로 검색, taskArn 이 서비스 이름을 포함하지 않으므로)
    MEDUSA_TASK=$(aws ecs list-tasks --cluster "$CLUSTER_ARN" --service-name Medusa --query 'taskArns[0]' --region ap-northeast-2 --output text)
    aws ecs execute-command --cluster "$CLUSTER_ARN" \
      --task "$MEDUSA_TASK" --container valkey --interactive --command /bin/sh
    # valkey 에서
    valkey-cli FLUSHDB  # 세션 전체 삭제 (모든 고객 강제 로그아웃)
    ```

### `x-publishable-api-key` 회전 여부

**회전 대상이 아니다.** 공개 키(`x-publishable-api-key`) 는 공개 가능 성격이고 권한이 제한적(상품 조회 등 읽기만)이어서 노출의 실질적 위협이 낮다. 비용-편익 상 회전 미필요 (Medusa 설정 + storefront/admin 코드 변경 + 배포 + 동기화 필요).

---

## 3. 적재분 처리

Grafana Cloud 의 **Tempo 와 Loki 는 선택 삭제가 불가능하다.** 두 선택지만 있다:

### 옵션 1: Retention 만료 대기 (권장 — 자동)

0-2 에서 확인한 retention 기간 후 자동 만료된다. 예를 들어 Tempo 가 2 주 보유라면 2026-08-28 이후 모든 노출 trace 가 사라진다.

**장점:**
- 개입 불필요 (자동)
- 계획 가능 (확정된 retention 값 기준)

**단점:**
- 노출 기간이 길 수 있음 (최대 기본 보유 기간)

### 옵션 2: Grafana 지원에 삭제 요청

즉시 삭제가 필요한 경우:

1. Grafana Cloud 콘솔 → **Support** 또는 **Account** → **Help**
2. 티켓 생성: "OTel incident: request delete spans/logs containing 'postgresql://' credentials from 2026-08-01 to 2026-08-14 in Tempo/Loki"
3. 대응 시간: 보통 1~2 영업일 (우선 지원 플랜별 상이)

**주의:** 대량 데이터 삭제는 Grafana 작업이라 응답 시간 불보장. 보통 수시간~수일 소요.

---

## 4. 완료 확인

코드 배포(Tasks 1-6) 후 **새 trace 에서 값이 없는지 확인한다:**

### Tempo 태그 조회

```bash
# 필요한 자격증명
cd deployments/lcnine/services
GRAFANA_TOKEN=$(npx sst secret list --stage live | sed -n 's/^GrafanaCloudApiToken=//p')
TEMPO_USERNAME=1523287  # GrafanaCloudTempoUsername 의 SST 기본값 (deployments/lcnine/services/infra/services.ts:125)
                         # 이 값에 default 가 있으므로 명시 set 되지 않은 경우 sst secret list 에 나타나지 않음.
                         # 기본값이 없는 Loki username 은 아래 "Loki 확인" 절의 LOKI_USERNAME 추출
                         # 커맨드로 별도로 받아야 한다 (여기 하드코딩된 TEMPO_USERNAME 과 다른 값).

curl -s -u "${TEMPO_USERNAME}:${GRAFANA_TOKEN}" -G \
  'https://tempo-prod-20-prod-ap-northeast-0.grafana.net/tempo/api/v2/search/tag/span.authorization/values' \
  -d "start=$(date -d '1 hour ago' +%s)" -d "end=$(date +%s)"
```

**기대:**
```json
{"tagValues":[]}
```

배포 이후 구간에서 태그가 **완전히 사라져야 한다.** 빈 배열이 확인되면 새 trace 에 헤더가 유출되지 않았다는 뜻.

**주의 — 이 결과만으로는 성공과 무트래픽을 구분할 수 없다.** Medusa 가 그 1 시간 동안
요청을 하나도 못 받았어도 `{"tagValues":[]}` 가 똑같이 나온다. 아래 positive control 로
같은 구간에 실제 trace 가 있었는지 반드시 같이 확인할 것 — 이게 비어 있으면 위 결과는
"고쳐졌다"가 아니라 "트래픽이 없었다"로 읽어야 한다.

### Positive control — 같은 구간에 trace 가 실제로 있었는지 확인

```bash
curl -s -u "${TEMPO_USERNAME}:${GRAFANA_TOKEN}" -G \
  'https://tempo-prod-20-prod-ap-northeast-0.grafana.net/tempo/api/v2/search/tag/span.http.route/values' \
  -d "start=$(date -d '1 hour ago' +%s)" -d "end=$(date +%s)"
```

**기대:** `tagValues` 가 비어 있지 않다 (예: `/store/products`, `/admin/orders` 등).
`span.authorization` 이 비어 있는데 이 값도 비어 있다면 배포가 성공했다는 근거가 아니라
Medusa 가 트래픽을 못 받았다는 뜻이므로, 실제 요청을 하나 보내고(예: 헬스체크 아닌 실제
엔드포인트) 재확인할 것.

### DB 접속 문자열 확인 (선택)

```bash
curl -s -u "${TEMPO_USERNAME}:${GRAFANA_TOKEN}" -G \
  'https://tempo-prod-20-prod-ap-northeast-0.grafana.net/tempo/api/v2/search/tag/span.db.connection_string/values' \
  -d "start=$(date -d '1 hour ago' +%s)" -d "end=$(date +%s)"
```

**기대:** 빈 배열. 혹시 값이 있다면 비밀번호 부분만 마스킹된 형태 (예: `postgresql://user:[REDACTED]@localhost:5432/db`). **원래 비밀번호가 평문으로 표시되면 안 된다.**

### Loki 확인

> **선행 조건:** 위 "Tempo 태그 조회" 섹션에서 `GRAFANA_TOKEN` 을 이미 설정했다면, 아래를 그대로 실행하면 됨.
> 별도로 실행하거나 스크립트를 다시 작성하는 경우, `GRAFANA_TOKEN` 을 먼저 정의할 것.

```bash
# (위 "Tempo 태그 조회"에서 GRAFANA_TOKEN 을 이미 설정했다고 가정)
LOKI_HOST=$(npx sst secret list --stage live | grep GrafanaCloudLokiOtlpEndpoint | sed 's|^.*https://||; s|/.*||')
LOKI_USERNAME=$(npx sst secret list --stage live | sed -n 's/^GrafanaCloudLokiUsername=//p')

curl -s -u "${LOKI_USERNAME}:${GRAFANA_TOKEN}" -G \
  "https://${LOKI_HOST}/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="medusa"} |= "postgresql://"' \
  -d "start=$(date -d '1 hour ago' +%s)000000000" \
  -d "end=$(date +%s)000000000" \
  -d limit=5
```

**기대:** 빈 결과 (로그 행 0 개)

### 주의사항

**Tempo 는 v2 태그 조회에 `span.` 스코프 프리픽스가 필수다.** 없으면 파싱 에러:
```
"error": "unknown identifier 'authorization'"
```
반드시 `span.authorization` 처럼 프리픽스를 포함해야 한다.

---

## 총괄 일정 (예시)

| 단계 | 예상 시간 | 참고 |
|------|---------|------|
| 0. 선행 확인 | 15 분 | Loki/Tempo retention 확인, Grafana 접속 필요 |
| 1. DB 비밀번호 회전 | 45~60 분 | 유지보수 창, 전 서비스 재배포 포함 |
| 2. Medusa 토큰 | 10 분 | 자동 (필요시 수동 로그아웃) |
| 3. 적재분 처리 | 즉시~수일 | Retention 만료 (자동) 또는 Grafana 지원 요청 |
| 4. 완료 확인 | 10 분 | Tempo/Loki 조회 |

**총 소요 시간:** 1~2 시간 (배포 대기 제외) + 지원 응답 시간 (선택)

---

## 참고

- **설계 문서:** `docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md`
- **코드 변경:** `apps/medusa/instrumentation.ts`, `apps/medusa/src/observability/`, `deployments/lcnine/services/observability/alloy/config.alloy`
- **Grafana Cloud 문서:** https://grafana.com/docs/grafana-cloud/
- **Alloy OTTL 참고:** https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md
