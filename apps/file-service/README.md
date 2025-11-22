# File Service

독립적인 파일 관리 마이크로서비스 - 다양한 스토리지 백엔드(S3, Local)를 추상화하여 통합된 파일 업로드/다운로드/관리 API를 제공합니다.

---

## 🚀 Quick Start

### 1. 환경 설정

`.env` 파일 생성:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/almondyoung_dev
PORT=3005

# Storage Provider (LOCAL or S3)
STORAGE_PROVIDER=LOCAL

# S3 Configuration (if STORAGE_PROVIDER=S3)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET=your_bucket
```

### 2. 데이터베이스 마이그레이션

```bash
cd apps/file-service
npx drizzle-kit generate:pg --config=./src/database/drizzle/drizzle.config.ts
npx drizzle-kit push:pg --config=./src/database/drizzle/drizzle.config.ts
```

### 3. 서비스 실행

```bash
# Development
npm run start:dev file-service

# Production
npm run build file-service
npm run start:prod file-service
```

### 4. API 문서 확인

```
http://localhost:3005/api
```

---

## 📋 Features

### ✅ 완료된 기능

- **다중 스토리지 지원**: S3, Local Storage (환경변수로 전환)
- **파일 업로드**: 단일/배치 업로드
- **파일 생명주기 관리**: pending → active → deleted
- **다운로드**: Signed URL 생성 (시간 제한)
- **메타데이터 조회**: 파일 정보 조회
- **자동 정리**: 24시간 이상 pending 상태 파일 자동 삭제
- **보안**: 업로더만 삭제 가능, Signed URL

### 🔮 향후 계획 (Phase 2)

- JWT 인증 통합
- 파일 타입 검증 (MIME whitelist)
- 이미지 썸네일 자동 생성
- 이미지 최적화 (WebP 변환)
- CDN 연동 (CloudFront)
- 바이러스 스캔

---

## 🏗️ Architecture

### 모듈 구조

```
file-service/
├── storage/       # 스토리지 추상화 (Provider 패턴)
├── shared/        # 공통 Repository, Constants, Types
├── upload/        # 파일 업로드
├── lifecycle/     # 파일 활성화/삭제
├── download/      # 다운로드 URL 생성, 메타데이터
└── cleanup/       # 고아 파일 정리 (Cron)
```

### 파일 생명주기

```
Upload (pending) → Activate (active) → Delete (soft delete)
     ↓
  24h 후 자동 삭제 (Cleanup)
```

---

## 🔌 API Endpoints

### Upload
- `POST /api/v1/files/upload` - 단일 파일 업로드
- `POST /api/v1/files/batch-upload` - 배치 파일 업로드

### Lifecycle
- `PATCH /api/v1/files/:fileId/activate` - 파일 활성화
- `DELETE /api/v1/files/:fileId` - 파일 삭제

### Download
- `GET /api/v1/files/:fileId/download` - Signed URL 생성
- `GET /api/v1/files/:fileId/metadata` - 파일 메타데이터 조회

---

## 📚 Documentation

- [Architecture](./docs/architecture.md) - 전체 아키텍처 설명
- [Implementation Summary](./docs/implementation-summary.md) - 구현 상세
- [Storage Provider Pattern](./docs/storage-provider-pattern.md) - Provider 패턴 가이드
- [Deployment Guide](./docs/deployment-guide.md) - 배포 가이드
- [Remaining Modules](./docs/remaining-modules.md) - 모듈별 상세 코드

---

## 🧪 Testing

### 수동 테스트 예시

#### 1. 파일 업로드

```bash
curl -X POST http://localhost:3005/api/v1/files/upload \
  -F "file=@./test-image.jpg" \
  -F "context=product-image"
```

응답:
```json
{
  "id": "01933e7a-1234-7890-abcd-0123456789ab",
  "url": "http://localhost:3000/files/local/products/images/2025/01/01933e7a-1234-7890-abcd-0123456789ab.jpg",
  "fileName": "01933e7a-1234-7890-abcd-0123456789ab.jpg",
  "size": 1024000,
  "status": "pending"
}
```

#### 2. 파일 활성화

```bash
curl -X PATCH http://localhost:3005/api/v1/files/01933e7a-1234-7890-abcd-0123456789ab/activate \
  -H "Content-Type: application/json" \
  -d '{
    "relatedType": "product",
    "relatedId": "01933e7b-5678-7890-abcd-0123456789cd"
  }'
```

#### 3. Signed URL 생성

```bash
curl http://localhost:3005/api/v1/files/01933e7a-1234-7890-abcd-0123456789ab/download?expiresIn=3600
```

#### 4. 파일 삭제

```bash
curl -X DELETE http://localhost:3005/api/v1/files/01933e7a-1234-7890-abcd-0123456789ab
```

---

## 🔧 Development

### 디렉토리 구조

```
apps/file-service/
├── src/
│   ├── cleanup/           # Cron 기반 정리
│   ├── config/            # 환경변수 검증
│   ├── database/          # Schema, Migrations
│   ├── download/          # 다운로드 로직
│   ├── lifecycle/         # 활성화/삭제
│   ├── shared/            # Repository, Constants
│   ├── storage/           # Provider 패턴
│   ├── upload/            # 업로드 로직
│   └── file-service.module.ts
├── docs/                  # 문서
└── README.md
```

### 새 스토리지 Provider 추가

1. `storage/providers/` 에 새 Provider 클래스 생성
2. `StorageUploadPort`, `StorageDeletePort` 등 구현
3. `StorageProviderRegistry`에 등록
4. 환경변수에 새 Provider 타입 추가

---

## 🛡️ Security

- ✅ JWT 인증 (placeholder 구현됨, 실제 JWT 연동 필요)
- ✅ 업로더만 파일 삭제 가능
- ✅ Signed URL로 시간 제한 다운로드
- ✅ Soft delete로 참조 유지
- ⏳ MIME 타입 검증 (TODO)
- ⏳ 파일 크기 제한 (TODO)
- ⏳ 바이러스 스캔 (TODO)

---

## 📊 Monitoring

### Cron Jobs

- **Daily 2 AM**: 고아 파일 정리 (pending > 24h)

### 로그 모니터링

```bash
# Cleanup 로그
grep "CleanupService" logs/file-service.log

# Upload 로그
grep "UploadService" logs/file-service.log
```

### 데이터베이스 쿼리

```sql
-- 상태별 파일 개수
SELECT status, COUNT(*) FROM uploads GROUP BY status;

-- 컨텍스트별 저장소 사용량
SELECT context, SUM(size) as total_bytes 
FROM uploads 
WHERE status = 'active' 
GROUP BY context;
```

---

## 🤝 Contributing

코드 스타일 가이드:
- NestJS 표준 패턴 준수
- Repository 패턴 사용
- DTO에 Swagger 문서화
- 서비스는 단순 Error throw, 컨트롤러에서 HTTP 에러 변환

---

## 📝 License

Almondyoung Internal Use

---

## 🔗 Related Services

- **PIM Service**: 상품 이미지 업로드에 사용
- **WMS Service**: 송장, 라벨 파일 관리
- **Wallet Service**: 결제 영수증 저장

---

## 📞 Support

문제 발생 시:
1. [Deployment Guide](./docs/deployment-guide.md#troubleshooting) 참고
2. 로그 확인
3. 데이터베이스 상태 확인

---

**구현 통계**
- 총 코드 라인: ~915 lines
- 모듈 수: 6개
- API 엔드포인트: 6개
- 구현 시간: 1 session

