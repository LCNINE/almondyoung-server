# Public 파일 기능 구현 계획서

**작성일**: 2025-12-17  
**목표**: 파일을 public/private 버킷으로 분리하고 context 기반 접근 제어 구현

---

## 📋 목차

1. [개요](#개요)
2. [현재 상황 분석](#현재-상황-분석)
3. [목표 아키텍처](#목표-아키텍처)
4. [구현 단계](#구현-단계)
5. [데이터베이스 변경](#데이터베이스-변경)
6. [코드 변경 사항](#코드-변경-사항)
7. [배포 체크리스트](#배포-체크리스트)
8. [테스트 계획](#테스트-계획)
9. [롤백 계획](#롤백-계획)

---

## 개요

### 배경
- 현재 모든 파일이 private 버킷에 저장되며 signed URL로만 접근 가능
- 상품 이미지 등 public 파일도 인증이 필요하여 직접 접근 불가
- Context(파일 용도)가 DB 제약 없이 varchar로만 관리되어 데이터 무결성 취약

### 목표
- **보안**: 개인정보는 물리적으로 분리된 private 버킷에 저장
- **성능**: Public 파일은 인증 없이 직접 접근 가능
- **무결성**: Context를 정규화하여 DB 레벨에서 검증
- **유연성**: Context별 세밀한 접근 제어 및 파일 제약 설정

---

## 현재 상황 분석

### 현재 구조

```
AWS S3 (단일 버킷)
├── products/images/        (private, signed URL 필요)
├── users/documents/        (private, signed URL 필요)
└── invoices/              (private, signed URL 필요)

uploads 테이블
├── context: varchar(50)   (제약 없음, 잘못된 값 입력 가능)
└── isPublic: boolean      (사용되지 않음)
```

### 문제점

1. **보안**: 모든 파일이 동일 버킷 (분리 없음)
2. **성능**: Public 파일도 signed URL 생성 오버헤드
3. **무결성**: Context 검증이 애플리케이션 레벨에만 존재
4. **유연성**: Context별 파일 크기, MIME type 제약을 코드로만 관리

---

## 목표 아키텍처

### 스토리지 구조

```
AWS S3 Public Bucket (almondyoung-files-public)
├── ACL: public-read
├── CORS: 허용
└── 파일:
    ├── products/images/
    └── products/documents/

AWS S3 Private Bucket (almondyoung-files-private)
├── ACL: private (기본값)
├── Block Public Access: 활성화
└── 파일:
    ├── users/documents/
    ├── finance/invoices/
    ├── finance/receipts/
    └── business/verification/
```

### 데이터베이스 구조

```
file_contexts (새 테이블)
├── id: varchar(50) PK
├── name: varchar(100)
├── description: text
├── allowPublic: boolean      ← 핵심
├── allowPrivate: boolean     ← 핵심
├── allowedMimeTypes: jsonb
├── maxFileSize: integer
├── pathPrefix: varchar(100)
├── isActive: boolean
├── createdAt: timestamp
└── updatedAt: timestamp

uploads (수정됨)
├── id: uuid PK
├── contextId: varchar(50) FK → file_contexts.id  ← 변경됨 (context → contextId)
├── isPublic: boolean          ← 실제 사용 시작
└── ... (기타 필드 동일)
```

---

## 구현 단계

### Phase 1: 데이터베이스 준비 (마이그레이션)

**Step 1.1**: `file_contexts` 테이블 생성

```sql
CREATE TABLE file_contexts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  allow_public BOOLEAN NOT NULL DEFAULT false,
  allow_private BOOLEAN NOT NULL DEFAULT true,
  allowed_mime_types JSONB,
  max_file_size INTEGER NOT NULL,
  path_prefix VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Step 1.2**: 초기 데이터 삽입

```sql
INSERT INTO file_contexts (id, name, description, allow_public, allow_private, allowed_mime_types, max_file_size, path_prefix) VALUES
  ('product-image', 'Product Image', 'Product photos for e-commerce catalog', true, false, '["image/jpeg","image/png","image/webp"]', 10485760, 'products/images'),
  ('product-document', 'Product Document', 'Product manuals, specifications', true, false, '["application/pdf"]', 52428800, 'products/documents'),
  ('user-avatar', 'User Avatar', 'User profile pictures', true, true, '["image/jpeg","image/png"]', 5242880, 'users/avatars'),
  ('user-document', 'User Document', 'ID cards, personal documents', false, true, '["image/jpeg","image/png","application/pdf"]', 20971520, 'users/documents'),
  ('invoice', 'Invoice', 'Financial invoices', false, true, '["application/pdf"]', 10485760, 'finance/invoices'),
  ('receipt', 'Receipt', 'Purchase receipts', false, true, '["application/pdf","image/jpeg","image/png"]', 5242880, 'finance/receipts'),
  ('shipment-label', 'Shipment Label', 'Shipping labels', false, true, '["application/pdf","image/png"]', 5242880, 'shipments/labels'),
  ('business-verification-file', 'Business Verification', 'Business license, tax documents', false, true, '["application/pdf","image/jpeg","image/png"]', 20971520, 'business/verification');
```

**Step 1.3**: `uploads` 테이블 수정

```sql
-- context_id 컬럼 추가 (nullable)
ALTER TABLE uploads ADD COLUMN context_id VARCHAR(50);

-- 기존 데이터 마이그레이션
UPDATE uploads SET context_id = context WHERE context IS NOT NULL;

-- NOT NULL 제약조건 추가
ALTER TABLE uploads ALTER COLUMN context_id SET NOT NULL;

-- 외래키 추가
ALTER TABLE uploads 
ADD CONSTRAINT fk_uploads_context 
FOREIGN KEY (context_id) REFERENCES file_contexts(id) ON DELETE RESTRICT;

-- 인덱스 추가
CREATE INDEX idx_uploads_context_id ON uploads(context_id);

-- 기존 context 컬럼 삭제
DROP INDEX IF EXISTS idx_uploads_context;
ALTER TABLE uploads DROP COLUMN context;
```

**예상 소요 시간**: 1-2시간 (마이그레이션 작성 및 테스트)

---

### Phase 2: 환경 변수 및 인프라 설정

**Step 2.1**: 환경 변수 스키마 수정

파일: `apps/file-service/src/config/env.validation.ts`

```typescript
export const fileServiceEnvSchema = z.object({
  // ... 기존 필드들
  
  // 변경됨: 단일 버킷 → 두 개의 버킷
  AWS_S3_PUBLIC_BUCKET: z.string().optional(),
  AWS_S3_PRIVATE_BUCKET: z.string().optional(),
  
  // 삭제: AWS_S3_BUCKET (기존)
})
.refine(
  (data) => {
    if (data.STORAGE_PROVIDER === 'S3') {
      return (
        data.AWS_REGION &&
        data.AWS_ACCESS_KEY_ID &&
        data.AWS_SECRET_ACCESS_KEY &&
        data.AWS_S3_PUBLIC_BUCKET &&
        data.AWS_S3_PRIVATE_BUCKET
      );
    }
    return true;
  },
  { message: 'AWS credentials and both PUBLIC/PRIVATE buckets required for S3' }
);
```

**Step 2.2**: AWS S3 버킷 생성

```bash
# Public 버킷 생성
aws s3 mb s3://almondyoung-files-public --region ap-northeast-2

# Private 버킷 생성
aws s3 mb s3://almondyoung-files-private --region ap-northeast-2

# Public 버킷 Block Public Access 해제
aws s3api put-public-access-block \
  --bucket almondyoung-files-public \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Public 버킷 정책 설정
aws s3api put-bucket-policy \
  --bucket almondyoung-files-public \
  --policy file://public-bucket-policy.json
```

`public-bucket-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::almondyoung-files-public/*"
    }
  ]
}
```

**Step 2.3**: 환경 변수 설정

```bash
# .env
STORAGE_PROVIDER=S3
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# 변경됨
AWS_S3_PUBLIC_BUCKET=almondyoung-files-public
AWS_S3_PRIVATE_BUCKET=almondyoung-files-private
```

**예상 소요 시간**: 30분 (인프라 설정)

---

### Phase 3: 코드 구현

**Step 3.1**: Storage Provider 인터페이스 확장

파일: `apps/file-service/src/storage/storage-provider.interface.ts`

```typescript
export interface UploadRequest {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
  isPublic?: boolean;  // ✨ 추가
}

export interface UploadResult {
  success: boolean;
  key: string;
  url: string;
  provider: StorageProviderType;
  isPublic: boolean;  // ✨ 추가
  metadata?: {
    etag?: string;
    versionId?: string;
    bucket?: string;  // ✨ 추가
  };
}

export interface DeleteRequest {
  key: string;
  isPublic?: boolean;  // ✨ 추가
}

export interface SignedUrlRequest {
  key: string;
  expiresIn: number;
  operation?: 'get' | 'put';
  isPublic?: boolean;  // ✨ 추가
}
```

**Step 3.2**: S3 Provider 수정

파일: `apps/file-service/src/storage/providers/s3-storage.provider.ts`

핵심 변경사항:
- 두 개의 버킷 설정 (publicBucket, privateBucket)
- `getBucket(isPublic)` 헬퍼 메소드
- `buildUrl(key, isPublic)` 헬퍼 메소드 (S3 direct URL 생성)
- Public 파일 업로드 시 `ACL: 'public-read'` 설정
- Public 파일은 signed URL 대신 직접 URL 반환

**Step 3.3**: 스키마 및 타입 정의

파일: `apps/file-service/src/database/schema.ts`

```typescript
// 새 테이블
export const fileContexts = pgTable('file_contexts', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  allowPublic: boolean('allow_public').default(false).notNull(),
  allowPrivate: boolean('allow_private').default(true).notNull(),
  allowedMimeTypes: jsonb('allowed_mime_types').$type<string[]>(),
  maxFileSize: integer('max_file_size').notNull(),
  pathPrefix: varchar('path_prefix', { length: 100 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 기존 테이블 수정
export const uploads = pgTable(
  'uploads',
  {
    // ... 기존 필드들
    contextId: varchar('context_id', { length: 50 })
      .notNull()
      .references(() => fileContexts.id, { onDelete: 'restrict' }),
    // ... 기타 필드들
  },
  (table) => [
    index('idx_uploads_context_id').on(table.contextId),
    // ... 기타 인덱스들
  ],
);

// Relations
export const fileContextsRelations = relations(fileContexts, ({ many }) => ({
  uploads: many(uploads),
}));

export const uploadsRelations = relations(uploads, ({ one }) => ({
  context: one(fileContexts, {
    fields: [uploads.contextId],
    references: [fileContexts.id],
  }),
}));
```

파일: `apps/file-service/src/database/types.ts`

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { fileContexts } from './schema';

export type FileContext = InferSelectModel<typeof fileContexts>;
export type NewFileContext = InferInsertModel<typeof fileContexts>;
export type UpdateFileContext = Partial<Omit<NewFileContext, 'id' | 'createdAt'>>;
```

**Step 3.4**: FileContext Repository 생성

파일: `apps/file-service/src/shared/repositories/file-context.repository.ts`

```typescript
@Injectable()
export class FileContextRepository {
  constructor(
    @InjectTypedDb<FileServiceDb>()
    private readonly dbService: DbService<FileServiceDb>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async findById(id: string): Promise<FileContext | undefined> {
    const [context] = await this.db
      .select()
      .from(fileContexts)
      .where(eq(fileContexts.id, id))
      .limit(1);
    return context;
  }

  async findAll(activeOnly = true): Promise<FileContext[]> {
    const query = this.db.select().from(fileContexts);
    if (activeOnly) {
      query.where(eq(fileContexts.isActive, true));
    }
    return query;
  }

  async update(id: string, data: UpdateFileContext): Promise<FileContext> {
    const [updated] = await this.db
      .update(fileContexts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(fileContexts.id, id))
      .returning();
    return updated;
  }
}
```

**Step 3.5**: FileContext 검증 로직

파일: `apps/file-service/src/shared/services/file-context-validator.service.ts`

```typescript
@Injectable()
export class FileContextValidator {
  
  /**
   * isPublic 접근 정책 계산
   */
  getPublicAccessPolicy(context: FileContext): {
    required: boolean;
    default?: boolean;
  } {
    const { allowPublic, allowPrivate } = context;
    
    if (!allowPublic && !allowPrivate) {
      throw new BadRequestException(
        `${context.name} does not allow any uploads`
      );
    }
    
    if (allowPublic && !allowPrivate) {
      return { required: false, default: true };
    }
    
    if (!allowPublic && allowPrivate) {
      return { required: false, default: false };
    }
    
    return { required: true };
  }
  
  /**
   * isPublic 값 결정 및 검증
   */
  resolveIsPublic(
    context: FileContext,
    requestedIsPublic?: boolean
  ): boolean {
    const policy = this.getPublicAccessPolicy(context);
    
    if (policy.required && requestedIsPublic === undefined) {
      throw new BadRequestException(
        `${context.name} requires explicit isPublic value`
      );
    }
    
    const isPublic = requestedIsPublic ?? policy.default!;
    
    if (isPublic && !context.allowPublic) {
      throw new BadRequestException(
        `${context.name} does not allow public uploads`
      );
    }
    
    if (!isPublic && !context.allowPrivate) {
      throw new BadRequestException(
        `${context.name} does not allow private uploads`
      );
    }
    
    return isPublic;
  }
  
  /**
   * MIME type 검증
   */
  validateMimeType(context: FileContext, mimeType: string): void {
    if (context.allowedMimeTypes && 
        !context.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type for ${context.name}. ` +
        `Allowed: ${context.allowedMimeTypes.join(', ')}`
      );
    }
  }
  
  /**
   * 파일 크기 검증
   */
  validateFileSize(context: FileContext, size: number): void {
    if (size > context.maxFileSize) {
      throw new BadRequestException(
        `File too large for ${context.name}. ` +
        `Max: ${(context.maxFileSize / 1024 / 1024).toFixed(1)}MB`
      );
    }
  }
}
```

**Step 3.6**: Upload DTO 수정

파일: `apps/file-service/src/upload/dto/upload-file.dto.ts`

```typescript
export class UploadFileDto {
  @ApiProperty({
    description: 'File context ID',
    enum: [
      'product-image',
      'product-document',
      'user-avatar',
      'user-document',
      'invoice',
      'receipt',
      'shipment-label',
      'business-verification-file',
    ],
    example: 'product-image',
  })
  @IsString()
  contextId: string;  // ← 변경됨 (context → contextId)

  @ApiProperty({
    description: 'Whether the file should be publicly accessible. ' +
                 'Required for contexts that allow both public and private.',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;  // ← 실제 사용 시작

  @ApiProperty({
    description: 'Additional metadata for the file',
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  // ... files 필드
}
```

**Step 3.7**: Upload Service 수정

파일: `apps/file-service/src/upload/upload.service.ts`

```typescript
@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
    private readonly fileContextRepository: FileContextRepository,  // ✨ 추가
    private readonly contextValidator: FileContextValidator,        // ✨ 추가
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
    userId: string
  ): Promise<UploadResponseDto> {
    // 1. Context 조회 및 검증
    const context = await this.fileContextRepository.findById(dto.contextId);
    
    if (!context) {
      throw new NotFoundException(`Context ${dto.contextId} not found`);
    }
    
    if (!context.isActive) {
      throw new BadRequestException(`${context.name} is currently disabled`);
    }
    
    // 2. MIME type 검증
    this.contextValidator.validateMimeType(context, file.mimetype);
    
    // 3. 파일 크기 검증
    this.contextValidator.validateFileSize(context, file.size);
    
    // 4. isPublic 결정
    const isPublic = this.contextValidator.resolveIsPublic(context, dto.isPublic);
    
    // 5. 경로 생성
    const fileId = uuidv7();
    const extension = this.getFileExtension(file.originalname);
    const filePath = this.pathBuilder.buildPath({
      prefix: context.pathPrefix,
      fileId,
      extension,
    });
    
    // 6. 업로드
    const uploadResult = await this.storageService.upload({
      key: filePath,
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic,  // ✨ 추가
      metadata: {
        uploadedBy: userId,
        contextId: dto.contextId,
      },
    });
    
    // 7. DB 저장
    const fileRecord = await this.fileRepository.create({
      id: fileId,
      fileName: `${fileId}.${extension}`,
      originalName: file.originalname,
      filePath: uploadResult.key,
      url: uploadResult.url,
      size: file.size,
      mimeType: file.mimetype,
      status: 'active',
      contextId: dto.contextId,  // ← 변경됨
      uploadedBy: userId,
      storageProvider: uploadResult.provider.toLowerCase(),
      isPublic,  // ✨ 실제 사용
      metadata: dto.metadata,
      activatedAt: new Date(),
    });
    
    return {
      id: fileRecord.id,
      url: fileRecord.url,
      fileName: fileRecord.fileName,
      size: fileRecord.size,
      status: fileRecord.status,
      isPublic: fileRecord.isPublic,  // ✨ 추가
    };
  }
  
  // ... 기타 메소드들
}
```

**Step 3.8**: Download Service 수정

파일: `apps/file-service/src/download/download.service.ts`

```typescript
async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<SignedUrlResponseDto> {
  const file = await this.fileRepository.findById(fileId);

  if (!file) throw new NotFoundException('File not found');
  if (file.status !== 'active') throw new BadRequestException('File is not active');

  // ✨ Public 파일은 직접 URL 반환
  if (file.isPublic) {
    return {
      signedUrl: file.url,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  // Private 파일만 signed URL 생성
  const signedUrlResult = await this.storageService.getSignedUrl({
    key: file.filePath,
    expiresIn,
    operation: 'get',
    isPublic: false,
  });

  return {
    signedUrl: signedUrlResult.signedUrl,
    expiresAt: signedUrlResult.expiresAt,
  };
}
```

**Step 3.9**: Public 파일 직접 접근 엔드포인트 추가 ⭐

파일: `apps/file-service/src/download/download.controller.ts`

Public 파일을 fileId만으로 직접 접근할 수 있는 엔드포인트 추가

```typescript
@Get('public/:fileId')
@Public()  // 인증 우회 데코레이터
@ApiOperation({ 
  summary: 'Serve public file directly by ID',
  description: 'Returns public file URL without authentication. Use in <img src="..." /> directly.'
})
@ApiParam({ name: 'fileId', description: 'File UUID' })
@ApiResponse({ status: 302, description: 'Redirects to S3 public URL' })
@ApiResponse({ status: 403, description: 'File is not public' })
@ApiResponse({ status: 404, description: 'File not found or inactive' })
async servePublicFile(
  @Param('fileId', ParseUUIDPipe) fileId: string,
  @Res() res: Response,
) {
  const file = await this.fileRepository.findById(fileId);

  if (!file) {
    throw new NotFoundException('File not found');
  }

  if (!file.isPublic) {
    throw new ForbiddenException('File is not public');
  }

  if (file.status !== 'active') {
    throw new NotFoundException('File not available');
  }

  // 302 리다이렉트로 실제 S3 public URL로 보냄
  // 브라우저는 자동으로 리다이렉트를 따라가서 파일을 로드함
  return res.redirect(302, file.url);
}

// ✨ 선택사항: HEAD 메소드 지원 (메타데이터만 확인)
@Head('public/:fileId')
@Public()
async checkPublicFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
  const file = await this.fileRepository.findById(fileId);

  if (!file || !file.isPublic || file.status !== 'active') {
    throw new NotFoundException();
  }

  return { exists: true };
}
```

**사용 예시:**

```html
<!-- 프론트엔드에서 바로 사용 가능 -->
<img 
  src="https://api.almondyoung.com/file-service/files/public/01234567-89ab-cdef-0123-456789abcdef" 
  alt="Product"
/>
```

**동작 방식:**
1. 브라우저가 `/files/public/{fileId}` 요청
2. file-service가 DB에서 파일 조회 및 권한 확인
3. 302 리다이렉트로 S3 public bucket URL 반환
4. 브라우저가 자동으로 S3 URL로 재요청
5. S3에서 파일 직접 서빙

**성능:**
- 첫 요청: ~50ms (DB 조회 + 리다이렉트)
- 이후 S3 요청: S3 직접 접근 (~20-50ms)

**Step 3.10**: PathBuilder Service 수정

파일: `apps/file-service/src/storage/path-builder.service.ts`

```typescript
@Injectable()
export class PathBuilderService {
  buildPath(params: {
    prefix: string;
    fileId: string;
    extension: string;
  }): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    // prefix는 file_contexts.pathPrefix에서 가져옴
    return `${params.prefix}/${year}/${month}/${params.fileId}.${params.extension}`;
  }
}
```

**예상 소요 시간**: 5-7시간 (코드 작성 및 단위 테스트)

---

### Phase 4: 통합 및 테스트

테스트는 작성하지 않음

---

## 데이터베이스 변경

### 마이그레이션 파일

파일: `apps/file-service/src/database/drizzle/migrations/YYYYMMDDHHMMSS_add_file_contexts.sql`

```sql
-- Step 1: Create file_contexts table
CREATE TABLE file_contexts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  allow_public BOOLEAN NOT NULL DEFAULT false,
  allow_private BOOLEAN NOT NULL DEFAULT true,
  allowed_mime_types JSONB,
  max_file_size INTEGER NOT NULL,
  path_prefix VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Step 2: Insert initial data
INSERT INTO file_contexts (id, name, description, allow_public, allow_private, allowed_mime_types, max_file_size, path_prefix) VALUES
  ('product-image', 'Product Image', 'Product photos for e-commerce catalog', true, false, '["image/jpeg","image/png","image/webp"]', 10485760, 'products/images'),
  ('product-document', 'Product Document', 'Product manuals, specifications', true, false, '["application/pdf"]', 52428800, 'products/documents'),
  ('user-avatar', 'User Avatar', 'User profile pictures', true, true, '["image/jpeg","image/png"]', 5242880, 'users/avatars'),
  ('user-document', 'User Document', 'ID cards, personal documents', false, true, '["image/jpeg","image/png","application/pdf"]', 20971520, 'users/documents'),
  ('invoice', 'Invoice', 'Financial invoices', false, true, '["application/pdf"]', 10485760, 'finance/invoices'),
  ('receipt', 'Receipt', 'Purchase receipts', false, true, '["application/pdf","image/jpeg","image/png"]', 5242880, 'finance/receipts'),
  ('shipment-label', 'Shipment Label', 'Shipping labels', false, true, '["application/pdf","image/png"]', 5242880, 'shipments/labels'),
  ('business-verification-file', 'Business Verification', 'Business license, tax documents', false, true, '["application/pdf","image/jpeg","image/png"]', 20971520, 'business/verification');

-- Step 3: Add context_id column to uploads
ALTER TABLE uploads ADD COLUMN context_id VARCHAR(50);

-- Step 4: Migrate existing data
UPDATE uploads SET context_id = context WHERE context IS NOT NULL;

-- Step 5: Add NOT NULL constraint
ALTER TABLE uploads ALTER COLUMN context_id SET NOT NULL;

-- Step 6: Add foreign key
ALTER TABLE uploads 
ADD CONSTRAINT fk_uploads_context 
FOREIGN KEY (context_id) REFERENCES file_contexts(id) ON DELETE RESTRICT;

-- Step 7: Create index
CREATE INDEX idx_uploads_context_id ON uploads(context_id);

-- Step 8: Drop old context column and index
DROP INDEX IF EXISTS idx_uploads_context;
ALTER TABLE uploads DROP COLUMN context;

-- Step 9: Add comment
COMMENT ON TABLE file_contexts IS 'File context definitions with access control and validation rules';
COMMENT ON COLUMN file_contexts.allow_public IS 'Whether files can be stored in public bucket';
COMMENT ON COLUMN file_contexts.allow_private IS 'Whether files can be stored in private bucket';
```

### 롤백 마이그레이션

파일: `apps/file-service/src/database/drizzle/migrations/YYYYMMDDHHMMSS_add_file_contexts_down.sql`

```sql
-- Rollback steps (역순)

-- Step 1: Restore context column
ALTER TABLE uploads ADD COLUMN context VARCHAR(50);

-- Step 2: Migrate data back
UPDATE uploads SET context = context_id;

-- Step 3: Restore index
CREATE INDEX idx_uploads_context ON uploads(context);

-- Step 4: Drop foreign key
ALTER TABLE uploads DROP CONSTRAINT fk_uploads_context;

-- Step 5: Drop context_id index
DROP INDEX idx_uploads_context_id;

-- Step 6: Drop context_id column
ALTER TABLE uploads DROP COLUMN context_id;

-- Step 7: Drop file_contexts table
DROP TABLE file_contexts;
```

---

## 코드 변경 사항

### 변경 파일 목록

#### 새로 생성

```
apps/file-service/src/
├── database/
│   ├── drizzle/migrations/YYYYMMDDHHMMSS_add_file_contexts.sql
│   └── types.ts (FileContext 타입 추가)
├── shared/
│   ├── repositories/
│   │   └── file-context.repository.ts (신규)
│   └── services/
│       └── file-context-validator.service.ts (신규)
└── docs/
    └── public-file-implementation-plan.md (본 문서)
```

#### 수정

```
apps/file-service/src/
├── config/
│   └── env.validation.ts (환경 변수 스키마 변경)
├── database/
│   └── schema.ts (file_contexts 테이블 추가, uploads 수정)
├── storage/
│   ├── providers/
│   │   └── s3-storage.provider.ts (2 버킷 지원)
│   ├── path-builder.service.ts (간소화)
│   └── storage-provider.interface.ts (isPublic 필드 추가)
├── upload/
│   ├── dto/
│   │   └── upload-file.dto.ts (contextId, isPublic 필드)
│   └── upload.service.ts (Context 검증 로직)
└── download/
    ├── download.controller.ts (✨ /public/:fileId 엔드포인트 추가)
    └── download.service.ts (Public 파일 처리)
```

### Breaking Changes

1. **환경 변수 변경**
   - `AWS_S3_BUCKET` → `AWS_S3_PUBLIC_BUCKET`, `AWS_S3_PRIVATE_BUCKET`
   - 기존 배포 환경에서 환경 변수 업데이트 필수

2. **DTO 변경**
   - `context: string` → `contextId: string`
   - 클라이언트 코드 수정 필요

3. **API 응답 변경**
   - `UploadResponseDto`에 `isPublic: boolean` 필드 추가

---

## 예상 일정

| Phase | 작업 | 소요 시간 | 담당 |
|-------|------|---------|------|
| Phase 1 | DB 마이그레이션 작성 | 2h | Backend |
| Phase 2 | 인프라 설정 (S3, 환경변수) | 1h | DevOps |
| Phase 3 | 코드 구현 | 6h | Backend |
| Phase 4 | 테스트 작성 및 실행 | 3h | Backend |
| - | **코드 리뷰** | 2h | Team |
| - | **QA 테스트** | 4h | QA |
| - | **배포 및 검증** | 2h | DevOps |
| **합계** | | **20h** | |

**예상 완료**: 3 영업일 (개발 2일 + QA/배포 1일)

---

## 성공 지표

### 기능적 지표

- [ ] Public 파일이 인증 없이 접근 가능
- [ ] Private 파일은 signed URL로만 접근 가능
- [ ] Context별 파일 제약이 DB 레벨에서 적용됨
- [ ] 잘못된 context 입력 시 DB 에러 발생

### 성능 지표

- [ ] Public 파일 리다이렉트 응답 시간 < 100ms
- [ ] Private 파일 signed URL 생성 < 200ms
- [ ] 업로드 성공률 > 99%

### 보안 지표

- [ ] Private 버킷 public access 차단 확인
- [ ] Public 버킷에 민감 정보 없음 확인
- [ ] Invoice/receipt 등은 private 버킷만 사용 확인

---

## Public 파일 직접 접근 패턴

### 기본 구현 (Phase 1)

**엔드포인트**: `GET /files/public/:fileId`

```html
<!-- 프론트엔드 사용 -->
<img src="https://api.almondyoung.com/file-service/files/public/{fileId}" />
```

**동작:**
1. 요청 → file-service
2. DB 조회 및 권한 확인 (~50ms)
3. 302 리다이렉트 → S3 public bucket URL
4. S3에서 파일 서빙

**장점:**
- ✅ 구현 간단
- ✅ 권한 체크 가능
- ✅ 통계/로깅 가능
- ✅ 삭제된 파일 접근 차단 가능

**보안:**
- ✅ Private 파일 접근 시도 → 403 Forbidden
- ✅ 삭제된 파일 접근 시도 → 404 Not Found
- ✅ 잘못된 fileId → 404 Not Found
- ✅ 인증 불필요 (public 파일만)

---

## 참고 자료

- [AWS S3 Public Access Settings](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [AWS S3 Bucket Policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)
- [Drizzle ORM Foreign Keys](https://orm.drizzle.team/docs/relations)
- [NestJS File Upload](https://docs.nestjs.com/techniques/file-upload)
- [NestJS Public Routes](https://docs.nestjs.com/security/authentication#enable-authentication-globally)

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|---------|--------|
| 2025-12-17 | 1.0 | 초안 작성 | AI Agent |
| 2025-12-17 | 1.1 | Public 파일 직접 접근 패턴 추가 | AI Agent |

---

**문서 끝**

