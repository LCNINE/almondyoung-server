# File Service - 남은 모듈 구현 가이드

## 구현 현황

### ✅ 완료
- **StorageModule**: S3/Local Provider, PathBuilder, Registry
- **환경 설정**: 환경변수 검증 (Zod)
- **프로젝트 구조**: NestJS 앱 스캐폴드
- **Database Schema**: uploads, fileReferences 테이블
- **SharedModule**: FileRepository, constants, types
- **UploadModule**: 단일/배치 파일 업로드
- **LifecycleModule**: 파일 활성화, 삭제
- **DownloadModule**: Signed URL, 메타데이터 조회
- **CleanupModule**: 고아 파일 정리 (Cron)

---

## 1. Database Schema

### 파일: `database/schema.ts`

```typescript
import { pgTable, uuid, varchar, text, integer, boolean, timestamp, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

// uploads 테이블
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    
    // 파일 기본 정보
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(),
    
    // 스토리지 정보
    filePath: text('file_path').notNull(),
    url: text('url').notNull(),
    storageProvider: varchar('storage_provider', { length: 20 }).default('s3').notNull(),
    
    // 상태 관리
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    
    // 컨텍스트
    context: varchar('context', { length: 50 }),
    
    // 연관 정보
    relatedType: varchar('related_type', { length: 50 }),
    relatedId: uuid('related_id'),
    
    // 메타데이터
    metadata: jsonb('metadata').$type<{
      width?: number;
      height?: number;
      duration?: number;
      pages?: number;
      [key: string]: any;
    }>(),
    
    // 보안
    uploadedBy: uuid('uploaded_by').notNull(),
    isPublic: boolean('is_public').default(false),
    
    // 타임스탬프
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
    activatedAt: timestamp('activated_at'),
  },
  (table) => [
    index('idx_uploads_status').on(table.status),
    index('idx_uploads_context').on(table.context),
    index('idx_uploads_related').on(table.relatedType, table.relatedId),
    index('idx_uploads_uploaded_by').on(table.uploadedBy),
    index('idx_uploads_created_at').on(table.createdAt),
  ],
);

// fileReferences 테이블
export const fileReferences = pgTable(
  'file_references',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    
    serviceType: varchar('service_type', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_file_refs_upload').on(table.uploadId),
    index('idx_file_refs_entity').on(table.serviceType, table.entityType, table.entityId),
    uniqueIndex('unique_file_reference').on(
      table.uploadId,
      table.serviceType,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const fileServiceSchema = {
  uploads,
  fileReferences,
};

export type FileServiceSchema = typeof fileServiceSchema;
```

---

## 2. SharedModule

### 구조
```
shared/
├── repositories/
│   └── file.repository.ts
├── constants/
│   ├── file-contexts.ts
│   └── file-statuses.ts
├── types/
│   └── file.types.ts
└── shared.module.ts
```

### file.repository.ts
```typescript
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { fileServiceSchema } from '../../database/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';

type FileServiceDb = typeof fileServiceSchema;

@Injectable()
export class FileRepository {
  constructor(
    @InjectTypedDb<FileServiceDb>()
    private readonly dbService: DbService<FileServiceDb>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async create(data: any) {
    const [file] = await this.db
      .insert(fileServiceSchema.uploads)
      .values(data)
      .returning();
    return file;
  }

  async findById(id: string) {
    const [file] = await this.db
      .select()
      .from(fileServiceSchema.uploads)
      .where(eq(fileServiceSchema.uploads.id, id))
      .limit(1);
    return file;
  }

  async updateStatus(id: string, status: string, additionalData?: any) {
    const [updated] = await this.db
      .update(fileServiceSchema.uploads)
      .set({
        status,
        updatedAt: new Date(),
        ...additionalData,
      })
      .where(eq(fileServiceSchema.uploads.id, id))
      .returning();
    return updated;
  }

  async softDelete(id: string) {
    const [deleted] = await this.db
      .update(fileServiceSchema.uploads)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(fileServiceSchema.uploads.id, id))
      .returning();
    return deleted;
  }

  async hardDelete(id: string) {
    await this.db
      .delete(fileServiceSchema.uploads)
      .where(eq(fileServiceSchema.uploads.id, id));
  }

  async findPendingOlderThan(date: Date) {
    return this.db
      .select()
      .from(fileServiceSchema.uploads)
      .where(
        and(
          eq(fileServiceSchema.uploads.status, 'pending'),
          lt(fileServiceSchema.uploads.createdAt, date),
        ),
      );
  }

  async findDeletedOlderThan(date: Date) {
    return this.db
      .select()
      .from(fileServiceSchema.uploads)
      .where(
        and(
          eq(fileServiceSchema.uploads.status, 'deleted'),
          lt(fileServiceSchema.uploads.deletedAt, date),
        ),
      );
  }

  async addReference(data: {
    uploadId: string;
    serviceType: string;
    entityType: string;
    entityId: string;
  }) {
    const [ref] = await this.db
      .insert(fileServiceSchema.fileReferences)
      .values(data)
      .returning();
    return ref;
  }

  async findReferences(uploadId: string) {
    return this.db
      .select()
      .from(fileServiceSchema.fileReferences)
      .where(eq(fileServiceSchema.fileReferences.uploadId, uploadId));
  }
}
```

### file-contexts.ts
```typescript
export const FILE_CONTEXTS = {
  PRODUCT_IMAGE: 'product-image',
  PRODUCT_DOCUMENT: 'product-document',
  USER_AVATAR: 'user-avatar',
  USER_DOCUMENT: 'user-document',
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  SHIPMENT_LABEL: 'shipment-label',
} as const;

export type FileContext = (typeof FILE_CONTEXTS)[keyof typeof FILE_CONTEXTS];
```

### file-statuses.ts
```typescript
export const FILE_STATUSES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DELETED: 'deleted',
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];
```

---

## 3. UploadModule

### upload.service.ts
```typescript
import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
  ) {}

  async uploadFile(file: Express.Multer.File, dto: UploadFileDto, userId: string) {
    const fileId = uuidv7();
    const extension = file.originalname.split('.').pop() || '';

    // 1. 경로 생성 (context만 사용, userId는 특정 context에서만)
    const filePath = this.pathBuilder.buildPath({
      context: dto.context,
      fileId,
      extension,
      userId: dto.context === 'user-avatar' || dto.context === 'user-document' ? userId : undefined,
      status: 'pending',
    });

    // 2. 스토리지 업로드
    const uploadResult = await this.storageService.upload({
      key: filePath,
      buffer: file.buffer,
      contentType: file.mimetype,
      metadata: {
        uploadedBy: userId,
        context: dto.context,
      },
    });

    // 3. DB 저장 (uploadedBy만 저장, relatedId/relatedType은 activate 시 설정)
    const fileRecord = await this.fileRepository.create({
      id: fileId,
      fileName: `${fileId}.${extension}`,
      originalName: file.originalname,
      filePath: uploadResult.key,
      url: uploadResult.url,
      size: file.size,
      mimeType: file.mimetype,
      status: 'pending',
      context: dto.context,
      uploadedBy: userId,  // ✅ 업로드한 사용자 UUID만 기록
      storageProvider: uploadResult.provider,
      // relatedId, relatedType은 null (activate 시 설정)
    });

    return {
      id: fileRecord.id,
      url: fileRecord.url,
      fileName: fileRecord.fileName,
      size: fileRecord.size,
      status: fileRecord.status,
    };
  }
}
```

### DTO 예시
```typescript
// dto/upload-file.dto.ts
import { IsEnum, IsOptional } from 'class-validator';
import { FILE_CONTEXTS, FileContext } from '../../shared/constants/file-contexts';

export class UploadFileDto {
  @IsEnum(FILE_CONTEXTS)
  context: FileContext;

  @IsOptional()
  metadata?: Record<string, any>;
}

// uploadedBy는 JWT에서 추출하므로 DTO에 포함하지 않음
// relatedId, relatedType은 업로드 시점에 불필요 (activate 시 설정)
```

---

## 4. LifecycleModule

### lifecycle.service.ts
```typescript
@Injectable()
export class LifecycleService {
  constructor(private readonly fileRepository: FileRepository) {}

  /**
   * 파일을 pending → active 상태로 전환
   * 이 시점에 relatedId, relatedType이 처음 설정됨
   */
  async activateFile(fileId: string, dto: ActivateFileDto) {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status !== 'pending') {
      return { success: true, message: 'Already active' };
    }

    // pending → active 전환 + 연관 엔티티 정보 저장
    const updated = await this.fileRepository.updateStatus(fileId, 'active', {
      activatedAt: new Date(),
      relatedId: dto.relatedId,        // ✅ 이 시점에 처음 설정
      relatedType: dto.relatedType,    // ✅ 이 시점에 처음 설정
    });

    return {
      success: true,
      fileId: updated.id,
      status: updated.status,
    };
  }

  /**
   * 파일 삭제 (soft delete)
   * 권한 확인: uploadedBy === 요청한 userId
   */
  async deleteFile(fileId: string, userId: string) {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // ✅ 업로드한 사용자만 삭제 가능
    if (file.uploadedBy !== userId) {
      throw new ForbiddenException('Not authorized to delete this file');
    }

    await this.fileRepository.softDelete(fileId);

    return { success: true };
  }
}
```

---

## 5. DownloadModule

### download.service.ts
```typescript
@Injectable()
export class DownloadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly fileRepository: FileRepository,
  ) {}

  async getSignedUrl(fileId: string, expiresIn: number = 3600) {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status !== 'active') {
      throw new BadRequestException('File is not active');
    }

    return this.storageService.getSignedUrl({
      key: file.filePath,
      expiresIn,
      operation: 'get',
    });
  }

  async getMetadata(fileId: string) {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url,
      status: file.status,
      context: file.context,
      metadata: file.metadata,
      createdAt: file.createdAt,
    };
  }
}
```

---

## 6. CleanupModule

### cleanup.service.ts
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly fileRepository: FileRepository,
  ) {}

  @Cron('0 2 * * *')
  async cleanupOrphanedFiles() {
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphaned = await this.fileRepository.findPendingOlderThan(cutoffDate);

    this.logger.log(`Found ${orphaned.length} orphaned files`);

    for (const file of orphaned) {
      try {
        await this.storageService.delete({ key: file.filePath });
        await this.fileRepository.hardDelete(file.id);
        this.logger.log(`Deleted orphaned file: ${file.id}`);
      } catch (error) {
        this.logger.error(`Failed to delete orphaned file ${file.id}:`, error);
      }
    }
  }
}
```

---

## 구현 순서

1. ✅ **Database Schema** - 완료
2. ✅ **SharedModule** - 완료
3. ✅ **UploadModule** - 완료 (단일/배치 업로드)
4. ✅ **LifecycleModule** - 완료 (activate, delete)
5. ✅ **DownloadModule** - 완료 (signed URL, metadata)
6. ✅ **CleanupModule** - 완료 (Cron)

## 핵심 플로우 요약

```
클라이언트 (JWT 포함)
    ↓
POST /files/upload
    ↓
UploadService
    - JWT에서 userId 추출
    - 파일 → S3
    - DB: { uploadedBy: userId, status: 'pending', relatedId: null }
    ↓
응답: { id, url, status: 'pending' }
    ↓
클라이언트가 비즈니스 로직 수행 (예: 상품 생성)
    ↓
비즈니스 로직 성공 → Outbox 이벤트
    ↓
PATCH /files/:id/activate
    ↓
LifecycleService
    - DB: { status: 'active', relatedId, relatedType, activatedAt }
```

각 모듈은 독립적으로 구현 가능하며, SharedModule만 먼저 구현되면 병렬로 작업 가능합니다.

