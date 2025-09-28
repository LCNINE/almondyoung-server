# 🐳 Docker 사용 가이드

## 📋 개요

이 프로젝트는 마이크로서비스 아키텍처로 구성되어 있으며, **Neon DB**(PostgreSQL)와 **Confluent Kafka**를 사용합니다. 각 서비스별로 Docker 컨테이너로 실행할 수 있습니다.

## ⚙️ 환경 설정

### 1. 환경변수 설정
```bash
# .env 파일 생성
cp .env.example .env

# 필수 환경변수 설정
# - DATABASE_URL: Neon DB 연결 문자열
# - KAFKA_BROKERS: Confluent Cloud 브로커
# - KAFKA_API_KEY: Confluent Cloud API Key
# - KAFKA_API_SECRET: Confluent Cloud Secret
```

### 2. 외부 서비스 설정
- **Neon DB**: https://console.neon.tech/
- **Confluent Cloud**: https://confluent.cloud/

## 🚀 빠른 시작

### 1. 핵심 서비스만 실행 (프로덕션 모드)
```bash
# 외부 DB/Kafka 사용하여 서비스만 실행
docker-compose up -d

# 실행되는 서비스:
# - wms (3010)
# - pim (3020)
# - user-service (3030)
```

### 2. 개발 모드 (로컬 인프라 포함)
```bash
# 로컬 Redis + Kafka 포함 실행
docker-compose --profile dev up -d

# 추가로 실행되는 서비스:
# - redis (6379)
# - kafka (9092)
# - kafka-ui (8081)
```

### 3. 전체 서비스 실행
```bash
# 모든 마이크로서비스 실행
docker-compose --profile full up -d

# 추가로 실행되는 서비스:
# - wallet (3040)
# - membership (3050)
# - notification (3060)
# - channel-adapter (3070)
```

## 🔧 개별 서비스 관리

### 개별 서비스 빌드
```bash
# 특정 서비스만 빌드
docker-compose build wms
docker-compose build pim
docker-compose build user-service
```

### 개별 서비스 실행
```bash
# 특정 서비스만 실행 (의존성 포함)
docker-compose up -d postgres redis wms
docker-compose up -d postgres redis pim
```

### 로그 확인
```bash
# 특정 서비스 로그
docker-compose logs -f wms
docker-compose logs -f pim

# 모든 서비스 로그
docker-compose logs -f
```

## 🛠️ 개발 워크플로우

### 1. 코드 변경 후 재빌드
```bash
# 서비스 중지
docker-compose stop wms

# 이미지 재빌드
docker-compose build wms

# 서비스 재시작
docker-compose up -d wms
```

### 2. 완전 재시작
```bash
# 모든 서비스 중지 및 제거
docker-compose down

# 이미지 재빌드
docker-compose build

# 서비스 재시작
docker-compose up -d
```

### 3. 데이터베이스 초기화
```bash
# 볼륨 포함 완전 제거
docker-compose down -v

# 다시 시작 (데이터베이스 초기화됨)
docker-compose up -d
```

## 🌐 서비스 접속 정보

### 마이크로서비스
| 서비스 | 포트 | 용도 | Health Check |
|--------|------|------|--------------|
| WMS | 3010 | 창고관리시스템 | http://localhost:3010/health |
| PIM | 3020 | 상품정보관리 | http://localhost:3020/health |
| User Service | 3030 | 사용자관리 | http://localhost:3030/health |
| Wallet | 3040 | 결제/지갑 | http://localhost:3040/health |
| Membership | 3050 | 멤버십 | http://localhost:3050/health |
| Notification | 3060 | 알림 | http://localhost:3060/health |
| Channel Adapter | 3070 | 채널연동 | http://localhost:3070/health |

### 로컬 인프라 (개발용)
| 서비스 | 포트 | 용도 | 접속 |
|--------|------|------|------|
| Redis | 6379 | 캐시/세션 | redis://localhost:6379 |
| Kafka | 9092 | 메시징 | localhost:9092 |
| Kafka UI | 8081 | Kafka 관리 | http://localhost:8081 |

### 외부 서비스 (프로덕션)
| 서비스 | 제공업체 | 용도 |
|--------|----------|------|
| PostgreSQL | Neon DB | 메인 데이터베이스 |
| Kafka | Confluent Cloud | 메시징 시스템 |
| Redis | Upstash/Redis Cloud | 캐시/세션 (선택적) |

## 🔍 트러블슈팅

### 포트 충돌
```bash
# 사용 중인 포트 확인
lsof -i :3010
lsof -i :5432

# 다른 포트로 실행
PORT=4010 docker-compose up -d wms
```

### 빌드 오류
```bash
# 캐시 없이 재빌드
docker-compose build --no-cache wms

# Docker 시스템 정리
docker system prune -f
docker volume prune -f
```

### 메모리 부족
```bash
# 사용하지 않는 컨테이너/이미지 정리
docker system prune -a

# 특정 서비스만 실행
docker-compose up -d postgres redis wms
```

## 📊 리소스 모니터링

### 컨테이너 상태 확인
```bash
# 실행 중인 컨테이너
docker-compose ps

# 리소스 사용량
docker stats

# 특정 컨테이너 상세 정보
docker inspect almondyoung-wms
```

### 로그 레벨 설정
```bash
# 환경변수로 로그 레벨 조정
LOG_LEVEL=debug docker-compose up -d wms
```

## 🚢 배포 준비

### 프로덕션 빌드
```bash
# 프로덕션용 이미지 빌드
docker-compose -f docker-compose.yml build

# 이미지 태깅
docker tag almondyoung-server_wms:latest your-registry.com/almondyoung/wms:v1.0.0

# 레지스트리에 푸시
docker push your-registry.com/almondyoung/wms:v1.0.0
```

### Railway 배포용
```bash
# Railway는 Dockerfile을 자동으로 감지
# apps/{service}/Dockerfile 경로만 지정하면 됨
```

## 💡 팁

1. **개발시**: 핵심 서비스만 실행하여 리소스 절약
2. **테스트시**: 전체 서비스 실행으로 통합 테스트
3. **디버깅시**: 개별 서비스 로그 확인
4. **성능이슈시**: docker stats로 리소스 모니터링
5. **데이터 보존**: `-v` 옵션 없이 down 실행