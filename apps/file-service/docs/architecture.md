# File Service Architecture

## 개요
file-service는 파일 업로드/다운로드/관리를 전담하는 독립적인 마이크로서비스입니다. S3, Local 등 다양한 스토리지를 추상화하여 다른 서비스(PIM, WMS, Wallet 등)에 통합된 파일 관리 API를 제공합니다.

## 설계 원칙

### 1. Provider 패턴 (Wallet 서비스 참고)
- 스토리지 제공자(S3, Local, GCS 등)를 Capability 기반으로 추상화
- 각 Provider는 지원하는 기능만 구현 (Interface Segregation)
- Registry가 Provider를 선택하고 조합

### 2. 관심사 분리
- Storage: 파일 저장소 추상화
- Upload: 업로드 로직 (업로드 시 즉시 active 상태)
- Lifecycle: 파일 삭제
- Download: 다운로드 및 조회

### 3. 간단한 아키텍처
- 파일 업로드 시 즉시 `active` 상태로 저장
- 소프트 삭제로 참조 무결성 유지

## 모듈 구조

```
file-service/
├── config/                    # 환경 설정
│   └── env.validation.ts      # 환경변수 검증 (Zod)
│
├── database/                  # 데이터베이스 스키마
│   ├── schema.ts              # uploads, fileReferences 테이블
│   └── drizzle/               # 마이그레이션
│
├── storage/                   # ✅ 스토리지 추상화 (완료)
│   ├── storage-provider.interface.ts
│   ├── storage-provider.registry.ts
│   ├── storage.service.ts
│   ├── path-builder.service.ts
│   ├── storage.module.ts
│   └── providers/
│       ├── s3-storage.provider.ts
│       └── local-storage.provider.ts
│
├── shared/                    # ✅ 공유 모듈 (완료)
│   ├── repositories/
│   │   └── file.repository.ts
│   ├── constants/
│   │   ├── file-contexts.ts
│   │   └── file-statuses.ts
│   ├── types/
│   │   └── file.types.ts
│   └── shared.module.ts
│
├── upload/                    # ✅ 업로드 모듈 (완료)
│   ├── upload.controller.ts
│   ├── upload.service.ts
│   ├── upload.module.ts
│   └── dto/
│       ├── upload-file.dto.ts
│       └── upload-response.dto.ts
│
├── lifecycle/                 # ✅ 생명주기 모듈 (완료)
│   ├── lifecycle.controller.ts
│   ├── lifecycle.service.ts
│   ├── lifecycle.module.ts
│   └── dto/
│       ├── activate-file.dto.ts
│       └── activate-response.dto.ts
│
├── download/                  # ✅ 다운로드 모듈 (완료)
     ├── download.controller.ts
     ├── download.service.ts
     ├── download.module.ts
     └── dto/
         ├── signed-url-response.dto.ts
         └── file-metadata-response.dto.ts
```

## 데이터 모델

### uploads 테이블
```typescript
{
  id: uuid (PK)                    // 파일 고유 ID (uuidv7)
  fileName: varchar(255)           // 저장된 파일명 (uuid.ext)
  originalName: varchar(255)       // 원본 파일명
  mimeType: varchar(100)           // MIME 타입
  filePath: text                   // 스토리지 전체 경로
  url: text                        // 접근 가능한 URL
  size: integer                    // 파일 크기 (bytes)
  
  // 상태 관리
  status: varchar(20)              // 'active', 'deleted'
  
  // 컨텍스트
  context: varchar(50)             // 'product-image', 'invoice' 등
  
  // 메타데이터
  metadata: jsonb                  // width, height, duration 등
  
  // 보안
  uploadedBy: uuid                 // 업로드한 사용자
  isPublic: boolean                // 공개 여부
  
  // 타임스탬프
  createdAt: timestamp
  updatedAt: timestamp
  deletedAt: timestamp             // soft delete
  activatedAt: timestamp           // active 전환 시각
}
```

> **참조 방향**: 어떤 도메인의 어떤 엔티티가 이 파일을 가리키는지는 file-service 가 추적하지 않는다. 호출 도메인 (catalog, library 등) 이 자기 스키마에서 `uploads.id` 를 FK 로 참조한다. 자세한 근거는 [docs/adr/0009-file-service-no-inbound-reference-tracking.md](../../../docs/adr/0009-file-service-no-inbound-reference-tracking.md).

## 파일 경로 전략

### 구조화된 경로 (S3 성능 최적화)
```
{context}/{subtype}/{year}/{month}/{fileId}.{extension}

예시:
products/images/2025/01/550e8400-e29b-41d4-a716-446655440000.jpg
users/avatars/user-abc/660e8400-e29b-41d4-a716-446655440001.jpg
invoices/2025/01/770e8400-e29b-41d4-a716-446655440002.pdf
```

### 장점
- S3 prefix 기반 파티셔닝으로 성능 향상
- Lifecycle 정책 적용 용이
- 비용 추적 및 관리 편리
- 특정 기간/타입 파일만 선택적 삭제 가능

## API 엔드포인트

### Public APIs
```
POST   /files/upload              # 단일 파일 업로드
POST   /files/batch-upload        # 배치 업로드
DELETE /files/:fileId             # 파일 삭제
GET    /files/:fileId/download    # Signed URL 발급
GET    /files/:fileId/metadata    # 메타데이터 조회
```


## 파일 생명주기

```
1. Upload (active)
   ↓
   사용자 인증 확인 (JWT)
   파일 → S3/Local 저장
   메타데이터 → DB 저장 (status: 'active', uploadedBy: userId)
   응답: { id, url, status: 'active' }
   
2. Delete (soft delete)
   ↓
   권한 확인 (uploadedBy === 요청 userId)
   status: 'active' → 'deleted'
   deletedAt 설정
   DB에 기록 유지 (참조용)
```

## 환경 설정

### 필수 환경변수
```bash
# Database
DATABASE_URL=postgresql://...
PORT=3005

# Storage
STORAGE_PROVIDER=S3          # S3 | LOCAL
AWS_REGION=ap-northeast-2    # S3 사용 시 필수
AWS_ACCESS_KEY_ID=...        # S3 사용 시 필수
AWS_SECRET_ACCESS_KEY=...    # S3 사용 시 필수
AWS_S3_BUCKET=...            # S3 사용 시 필수

# Kafka (Outbox)
KAFKA_BROKERS=...
KAFKA_CLIENT_ID_PREFIX=file-service
KAFKA_GROUP_ID=file-service-group
```

### 개발/프로덕션 전환
```bash
# 개발 환경 (.env.development)
STORAGE_PROVIDER=LOCAL

# 프로덕션 환경 (.env.production)
STORAGE_PROVIDER=S3
```

## 보안 고려사항

### 1. 파일 접근 제어
- JWT 인증: 모든 API는 인증된 사용자만 접근 가능
- 업로드 권한: 인증된 사용자는 누구나 업로드 가능
- 삭제 권한: 업로드한 사용자만 삭제 가능 (`uploadedBy` 확인)
- Signed URL로 임시 다운로드 권한 부여
- `isPublic` 플래그로 공개/비공개 구분

### 2. 파일 검증
- MIME 타입 화이트리스트
- 파일 크기 제한
- (향후) 바이러스 스캔

### 3. 경로 보안
- UUID로 파일명 생성 (예측 불가)
- 경로에 사용자 정보 포함 방지 (userId는 서버에서만 관리)
- S3 경로는 context 기반으로만 구성

## 확장 계획

### Phase 2
- 이미지 썸네일 자동 생성
- 이미지 최적화 (WebP 변환)
- CDN 연동 (CloudFront)
- 대용량 파일 멀티파트 업로드

### Phase 3
- 바이러스 스캔 (ClamAV)
- 중복 파일 제거 (해시 기반)
- 파일 버전 관리
- 다중 리전 지원
- GCS, Azure Blob 지원

## 모니터링

### 메트릭
- 업로드 성공/실패율
- 평균 업로드 시간
- 스토리지 사용량 (Provider별)
- 파일 삭제 건수

### 로그
- 파일 업로드/삭제 이벤트
- 상태 전환 이벤트
- 스토리지 에러
- 권한 위반 시도

## 참고 문서
- [Storage Provider Pattern](./storage-provider-pattern.md) - Provider 패턴 가이드
- [Deployment Guide](./deployment-guide.md) - 배포 가이드

