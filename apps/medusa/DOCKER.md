# Medusa Docker 배포 가이드

## 🚀 빠른 시작

### 1. Docker Compose로 전체 스택 실행

```bash
cd apps/medusa
docker-compose up -d
```

이 명령어로 다음 서비스들이 실행됩니다:
- **PostgreSQL** (포트 5432)
- **Redis** (포트 6379)
- **Medusa** (포트 9000)
- **pgAdmin** (포트 5050) - 데이터베이스 관리 도구

### 2. 개별 이미지 빌드

```bash
# 프로젝트 루트에서
docker build -t almondyoung/medusa -f apps/medusa/Dockerfile .
```

### 3. 개별 컨테이너 실행

```bash
docker run -p 9000:9000 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/postgres" \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  almondyoung/medusa
```

---

## 🔧 환경변수 설정

### 필수 환경변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | - |
| `REDIS_URL` | Redis 연결 문자열 | 없으면 메모리 기반 사용 |

### 선택적 환경변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `KAFKA_BROKERS` | Kafka 브로커 주소 (콤마 구분) | `localhost:9092` |
| `KAFKA_CLIENT_ID` | Kafka 클라이언트 ID | `medusa-service` |
| `KAFKA_GROUP_ID` | Kafka 컨슈머 그룹 ID | `medusa-consumer` |
| `KAFKAJS_NO_PARTITIONER_WARNING` | Kafka 파티셔너 경고 숨김 | - |
| `JWT_SECRET` | JWT 서명 키 | `supersecret` |
| `COOKIE_SECRET` | 쿠키 암호화 키 | `supersecret` |
| `JWT_EXPIRES_IN` | JWT 만료 시간 | `30d` |
| `STORE_CORS` | Store API CORS 설정 | - |
| `ADMIN_CORS` | Admin API CORS 설정 | - |
| `AUTH_CORS` | Auth API CORS 설정 | - |
| `USER_SERVICE_URL` | User Service API URL | - |

---

## 📦 빌드 과정

Dockerfile은 다음 단계로 빌드됩니다:

1. **루트 의존성 설치**: 모노레포 공통 의존성 설치
2. **Medusa 의존성 설치**: yarn으로 Medusa 앱 의존성 설치
3. **소스 복사**: Medusa 앱 + 공용 libs 복사
4. **애플리케이션 빌드**: `yarn build`로 Medusa Admin UI 포함 빌드
5. **프로덕션 설정**: NODE_ENV=production 설정

---

## 🐛 트러블슈팅

### 에러: `Cannot find module '@medusajs/ui-preset'`

**원인**: devDependencies가 프로덕션 빌드에서 제거됨

**해결**: 이미 수정됨. `@medusajs/ui-preset`이 dependencies로 이동됨.

### 에러: `Could not find index.html in the admin build directory`

**원인**: 빌드 후 `yarn install --production` 재실행으로 빌드 결과물 손상

**해결**: 이미 수정됨. Dockerfile에서 빌드 후 재설치 단계 제거됨.

### 경고: Kafka 연결 실패

```
[BrokerPool] Failed to connect to seed broker
```

**원인**: Kafka가 실행되지 않았거나 `KAFKA_BROKERS` 환경변수가 잘못됨

**해결**: 
- Kafka가 필수가 아니면 무시 (이벤트는 in-memory 처리)
- Kafka 사용 시: `KAFKA_BROKERS` 환경변수 설정

### 경고: Redis 없음

```
redisUrl not found. A fake redis instance will be used.
```

**원인**: `REDIS_URL` 환경변수가 제공되지 않음

**해결**: 
- 개발: 무시 (메모리 기반 캐시 사용)
- 프로덕션: `-e REDIS_URL="redis://redis:6379"` 추가 권장

---

## 🔍 로그 확인

```bash
# Docker Compose 로그
docker-compose logs -f medusa

# 개별 컨테이너 로그
docker logs -f <container-id>
```

---

## 🛑 중지 및 정리

```bash
# 컨테이너 중지
docker-compose down

# 볼륨까지 삭제 (데이터 삭제 주의!)
docker-compose down -v

# 이미지 삭제
docker rmi almondyoung/medusa
```

---

## 📝 참고사항

- **이미지 크기**: devDependencies 포함으로 약간 크지만 안정성 우선
- **프로덕션 권장**: Redis, Kafka 등 외부 인프라 사용
- **보안**: JWT_SECRET, COOKIE_SECRET은 반드시 프로덕션에서 변경
- **모니터링**: Admin UI는 `http://localhost:9000/app` 에서 접근
