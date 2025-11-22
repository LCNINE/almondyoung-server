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
- Upload: 업로드 로직
- Lifecycle: 상태 전환 (pending → active → deleted)
- Download: 다운로드 및 조회
- Cleanup: 고아 파일 정리
- Internal: 다른 서비스용 내부 API

### 3. 이벤트 기반 아키텍처
- 파일 업로드 시 `pending` 상태로 시작
- 비즈니스 로직 성공 후 `active`로 전환
- Outbox 패턴으로 이벤트 손실 방지

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
│   ├── download.controller.ts
│   ├── download.service.ts
│   ├── download.module.ts
│   └── dto/
│       ├── signed-url-response.dto.ts
│       └── file-metadata-response.dto.ts
│
└── cleanup/                   # ✅ 정리 모듈 (완료)
    ├── cleanup.service.ts
    └── cleanup.module.ts
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
  status: varchar(20)              // 'pending', 'active', 'deleted'
  
  // 컨텍스트
  context: varchar(50)             // 'product-image', 'invoice' 등
  
  // 연관 정보 (activate 시 설정)
  relatedType: varchar(50)         // 'product', 'user' 등 (nullable)
  relatedId: uuid                  // 연관 엔티티 ID (nullable)
  
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

### fileReferences 테이블
```typescript
{
  id: uuid (PK)
  uploadId: uuid (FK → uploads.id)
  
  // 참조 정보
  serviceType: varchar(50)         // 'pim', 'wms', 'wallet'
  entityType: varchar(50)          // 'product', 'invoice'
  entityId: uuid                   // 엔티티 ID
  
  createdAt: timestamp
}
```

## 파일 경로 전략

### 구조화된 경로 (S3 성능 최적화)
```
{context}/{subtype}/{year}/{month}/{fileId}.{extension}

예시:
products/images/2025/01/550e8400-e29b-41d4-a716-446655440000.jpg
users/avatars/user-abc/660e8400-e29b-41d4-a716-446655440001.jpg
invoices/2025/01/770e8400-e29b-41d4-a716-446655440002.pdf
temp/pending/2025/01/880e8400-e29b-41d4-a716-446655440003.jpg
```

### 장점
- S3 prefix 기반 파티셔닝으로 성능 향상
- Lifecycle 정책 적용 용이
- 비용 추적 및 관리 편리
- 특정 기간/타입 파일만 선택적 삭제 가능

## API 엔드포인트

### Public APIs
```
POST   /api/v1/files/upload              # 단일 파일 업로드
POST   /api/v1/files/batch-upload        # 배치 업로드
PATCH  /api/v1/files/:fileId/activate    # 파일 활성화
DELETE /api/v1/files/:fileId             # 파일 삭제
GET    /api/v1/files/:fileId/download    # Signed URL 발급
GET    /api/v1/files/:fileId/metadata    # 메타데이터 조회
```


## 파일 생명주기

```
1. Upload (pending)
   ↓
   사용자 인증 확인 (JWT)
   파일 → S3 저장
   메타데이터 → DB 저장 (status: 'pending', uploadedBy: userId)
   응답: { id, url, status: 'pending' }
   
2. Business Logic Success (다른 서비스)
   ↓
   Outbox 이벤트 발행 (file.activate)
   payload: { uploadId, relatedId, relatedType }
   
3. Activate (active)
   ↓
   file-service가 이벤트 수신
   status: 'pending' → 'active'
   activatedAt 설정
   relatedId, relatedType 저장 (이 시점에 처음 설정)
   
4. Delete (deleted)
   ↓
   권한 확인 (uploadedBy === 요청 userId)
   status: 'active' → 'deleted'
   deletedAt 설정
   
5. Cleanup (pending files only)
   ↓
   24시간 이상 pending 상태인 파일 → S3 + DB 완전 삭제
   deleted 상태 파일은 DB에 유지 (참조용)
```

## 고아 파일 방지 전략

### 문제
- 파일 업로드 성공 → 비즈니스 로직 실패 → 참조되지 않는 파일 발생

### 해결
1. **상태 기반 관리**
   - 업로드 시 `pending` 상태
   - 비즈니스 로직 성공 후 `active`로 전환

2. **Outbox 패턴**
   - 비즈니스 로직과 이벤트를 동일 트랜잭션에 저장
   - OutboxDispatcher가 주기적으로 이벤트 처리
   - At-least-once 전달 보장

3. **자동 정리 스케줄러**
   - 24시간 이상 `pending` 상태 → 완전 삭제 (S3 + DB)
   - `deleted` 상태 파일은 DB에 유지 (참조용)

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
- 고아 파일 정리 건수
- Pending 상태 체류 시간

### 로그
- 파일 업로드/삭제 이벤트
- 상태 전환 이벤트
- 스토리지 에러
- 권한 위반 시도

## 참고 문서
- [Remaining Modules](./remaining-modules.md) - 미구현 모듈 상세
- [Storage Provider Pattern](./storage-provider-pattern.md) - Provider 패턴 가이드
- [API Specification](./api-spec.md) - API 상세 명세

