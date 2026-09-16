# OpenSearch 이관 — Railway → AWS (VPC)

검색 백엔드를 Railway 자체호스팅 OpenSearch 에서 VPC 안의 AWS OpenSearch 도메인으로 옮긴다.
**검색 이력(`search_query_events`)은 Railway 에만 있는 원본**이라 같이 들고 간다.

## 왜

Railway 인스턴스는 백업도 인증도 없는 공개 엔드포인트였고, **검색 이력의 유일본**을 들고
있었다. 저장소가 하나뿐이라 그게 응답하지 않으면 검색이 통째로 멈추고 되돌릴 사본도 없다.

전환을 확인할 때 주의할 점: 검색 페이지는 백엔드가 죽어도 200 + 「검색 결과가 없습니다」로
뜬다. **상태 코드로는 안 보이므로 «결과 수»를 세야 한다**(7번).

## 무엇이 바뀌나

| | 전 | 후 |
|---|---|---|
| 엔드포인트 | 공개 `opensearch-development.up.railway.app` | VPC private subnet 도메인 |
| 인증 | 없음 | SST 가 만드는 FGAC master user |
| 사양 | (Railway 요금제) | t3.small × 1, gp3 10GB |
| 형태소 분석 | 이미지 내장 | AWS `analysis-nori` 패키지 associate |

노드는 **하나**다. 삭제 전 구성과 같다 — 인덱스의 `number_of_replicas: 1` 은 배정되지 않아
클러스터는 계속 **yellow** 이고, 이건 정상이다(Railway 도 같은 상태였다). 노드 한 대가
죽으면 검색이 다시 통째로 멈춘다. 이중화하려면 `instanceCount: 2` + `zoneAwarenessEnabled`
로 올린다. 비용은 `aws pricing get-products --service-code AmazonES` 로 그때 단가를 뽑을 것 —
여기 적어 두면 갈린다.

## 전제

- `develop` 에 `[search] OpenSearch 장애 시 부팅 유지와 자동 재연결`이 들어가 있을 것.
  **이게 이 이관의 안전망이다** — 새 도메인이 아직 비어 있거나 접속이 안 돼도 search 앱은 죽지
  않고 뜨며, 같은 태스크의 notification·ugc 를 끌고 가지 않는다.
- VPC 프라이빗 서브넷의 인터넷 출구는 NAT **인스턴스**다(NAT 게이트웨이 없음). 같은 인스턴스가
  SSM 세션 대상이기도 하다.

## 절차

### 1. 도메인 생성 (배포 ①)

```bash
cd deployments/lcnine/services
sst deploy --stage live
```

`shared.ts` 의 `Opensearch` + `OpensearchSg` + `OpensearchNoriAssociation` 이 생성된다.
**nori 패키지 associate 는 plugin install + rolling restart 라 수십 분 걸린다**(그래서
customTimeouts 가 60분이다). 배포가 길어져도 정상이다.

**이 배포는 컷오버가 아니다.** `services.ts` 의 `useAwsOpenSearch` 가 `false` 인 동안 앱은
Railway 를 계속 본다 — 도메인이 비어 있는 채로 트래픽을 받는 창이 없다. 컷오버는 5번이다.

### 2. 도메인에 접속 경로 열기

도메인이 VPC 안이라 로컬에서 바로 안 닿는다. NAT/bastion 인스턴스를 거쳐 포트를 뚫는다.

로컬에 `session-manager-plugin` 이 있어야 한다(`session-manager-plugin --version`).

```bash
# 도메인 엔드포인트 (vpc-... 로 시작하는 사설 엔드포인트)
DOMAIN=$(aws opensearch list-domain-names --query 'DomainNames[0].DomainName' --output text)
ENDPOINT=$(aws opensearch describe-domain --domain-name "$DOMAIN" \
  --query 'DomainStatus.Endpoints.vpc' --output text)

# 경유할 인스턴스 — 프라이빗 서브넷 라우트의 NAT 인스턴스. SSM Online 인 것을 고른다
aws ec2 describe-route-tables --filters Name=vpc-id,Values=<vpc-id> \
  --query 'RouteTables[].Routes[?DestinationCidrBlock==`0.0.0.0/0`].InstanceId' --output text
aws ssm describe-instance-information --query 'InstanceInformationList[].[InstanceId,PingStatus]' --output text

# 터널. 이 창은 작업 내내 열어 둔다
aws ssm start-session \
  --target <instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$ENDPOINT\"],\"portNumber\":[\"443\"],\"localPortNumber\":[\"9243\"]}"
```

터널을 쓰면 인증서 호스트명이 `localhost` 와 안 맞으므로 다음 단계에서 `TARGET_TLS_INSECURE=1`
을 준다. **TLS 자체는 유지되고 검증만 끈다** — 터널 구간은 SSM 이 이미 암호화한다.

### 3. 데이터 복사

자격증명은 SST 가 만든 master user 다. `sst secret` 이 아니라 **Secrets Manager** 에 있다 —
SST 가 도메인 태그 `sst:ref:password` 에 시크릿 id 를, `sst:ref:username` 에 사용자명을 박아둔다.

```bash
DOMAIN=$(aws opensearch list-domain-names --query 'DomainNames[0].DomainName' --output text)
ARN=$(aws opensearch describe-domain --domain-name "$DOMAIN" --query 'DomainStatus.ARN' --output text)
SECRET_ID=$(aws opensearch list-tags --arn "$ARN" \
  --query "TagList[?Key=='sst:ref:password'].Value | [0]" --output text)

aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
  --query SecretString --output text     # {"username":"admin","password":"..."}
```

```bash
export SOURCE_OPENSEARCH_NODE=https://opensearch-development.up.railway.app
export TARGET_OPENSEARCH_NODE=https://localhost:9243
export TARGET_OPENSEARCH_USERNAME=<master user>
export TARGET_OPENSEARCH_PASSWORD=<master password>
export TARGET_TLS_INSECURE=1
export SEARCH_PRODUCTS_INDEX=search_products_v2

npm run search:migrate-opensearch:dry   # 읽기만 한다. 건수·접속 확인용
npm run search:migrate-opensearch
```

스크립트가 하는 일:

- 대상 인덱스를 **이 저장소의 상수**로 만든다(소스 설정을 복사하지 않는다). 소스가 드리프트해
  있어도 새 클러스터는 앱이 기대하는 모양으로 선다. 엔진 버전이 달라도 무방하다.
- `_source` 를 그대로 옮기므로 **상품명 벡터가 보존된다** — 재임베딩(OpenAI) 비용이 없다.
- 소스 `_id` 로 bulk index 한다. **여러 번 돌려도 안전**하고, 끊기면 다시 돌리면 된다.
- 마지막에 소스/대상 문서 수를 대조해 안 맞으면 실패로 끝낸다.

### 4. 새 도메인이 실제로 답하는지 확인 (컷오버 «전»)

전환하기 전에 새 도메인에서 직접 검색이 되는지 본다. 2026-05 에 이 도메인으로 붙다가 원인
미상의 「연결 트러블슈팅」으로 Railway 로 물러난 이력이 있어(`4225496b3`), 이 단계를 건너뛰면
같은 일을 반복할 수 있다.

```bash
# 문서 수
curl -sk -u "$TARGET_OPENSEARCH_USERNAME:$TARGET_OPENSEARCH_PASSWORD" \
  "$TARGET_OPENSEARCH_NODE/_cat/indices?v&h=index,docs.count,store.size"

# nori 가 실제로 붙었나 — 안 붙었으면 한국어 검색 품질이 조용히 무너진다
curl -sk -u "$TARGET_OPENSEARCH_USERNAME:$TARGET_OPENSEARCH_PASSWORD" \
  -H 'Content-Type: application/json' \
  "$TARGET_OPENSEARCH_NODE/search_products_v2/_analyze" \
  -d '{"analyzer":"nori","text":"헤어에센스"}'

# 실제 검색이 결과를 내나
curl -sk -u "$TARGET_OPENSEARCH_USERNAME:$TARGET_OPENSEARCH_PASSWORD" \
  -H 'Content-Type: application/json' \
  "$TARGET_OPENSEARCH_NODE/search_products_v2/_search?size=1" \
  -d '{"query":{"match":{"name":"헤어"}}}'
```

셋 다 통과해야 다음으로 간다.

### 5. 컷오버 (배포 ②)

`deployments/lcnine/services/infra/services.ts` 에서 한 줄을 바꾼다.

```ts
const useAwsOpenSearch = true;
```

```bash
sst deploy --stage live
```

### 6. 꼬리 복사

복사하는 동안에도 문서는 계속 쌓인다. **컷오버가 끝난 뒤 한 번 더 돌린다.** 멱등이라 전체를 다시 훑고 바뀐 것만 덮어쓴다.

```bash
npm run search:migrate-opensearch
```

`search_products_v2` 는 이걸 놓쳐도 Kafka 소비자와 `npm run search:backfill` 로 복구된다.
`search_query_events` 는 **복구 경로가 없다** — 이 단계를 건너뛰면 그 사이 검색 이력이 사라진다.

### 7. 고객 화면 확인

```bash
# 앱이 새 도메인을 보고 있나
curl -s https://search.almondyoung.com/health

# 검색이 실제로 결과를 내나 (상태 코드가 아니라 «결과 수»를 본다)
curl -s "https://almondyoung.com/kr/search?q=%ED%97%A4%EC%96%B4" | grep -c 'href="/kr/products/'
# 홈을 양성 대조로: 0 이 아니어야 한다
curl -s "https://almondyoung.com/kr" | grep -c 'href="/kr/products/'
```

관리자 통계 → 검색 키워드 탭에서 인기 검색어·0건 검색어가 **이관 이전 기간까지** 나오는지 본다.
이력이 안 옮겨졌으면 여기서 드러난다.

### 8. Railway 정리

**최소 며칠은 켜 둔다.** 되돌릴 유일한 경로이고, 검색 이력의 두 번째 사본이다.
확인이 끝나면 Railway 쪽 비용을 정리한다(요금제는 이 문서 범위 밖).

## 되돌리기

`useAwsOpenSearch` 를 `false` 로 되돌리고 재배포한다. 도메인은 지우지 말고 남겨 둔다
(원인 파악용이고, 지웠다 다시 만들면 nori associate 를 또 수십 분 기다려야 한다).

되돌린 뒤 Railway 는 컷오버 시점까지의 검색 이력을 그대로 갖고 있다. 컷오버 이후 AWS 에만
쌓인 이력을 되가져오려면 같은 스크립트를 소스/대상만 바꿔 돌리면 된다.

## 알려진 위험

- **2026-05 에 이 도메인으로 붙다가 「연결 트러블슈팅」 사유로 Railway 로 폴백한 이력이 있다**
  (`4225496b3`). 원인이 기록돼 있지 않다. **4번(컷오버 전)과 7번(고객 화면)을 반드시 통과시킨
  뒤** Railway 를 끊을 것.
- nori associate 가 60분 안에 안 끝나면 배포가 실패한다. 그때 도메인은 이미 떠 있으므로
  `aws opensearch describe-packages` 로 패키지 ID 가 엔진 버전과 맞는지부터 확인한다.
- 노드가 하나라 클러스터는 계속 yellow 다. 「yellow 면 이상」이라는 알림을 붙이면 상시 울린다.
