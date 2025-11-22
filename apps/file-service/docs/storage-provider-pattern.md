# Storage Provider Pattern 가이드

## 개요
Storage Provider 패턴은 다양한 파일 스토리지(S3, GCS, Azure Blob, Local 등)를 추상화하여 애플리케이션이 특정 스토리지 구현에 의존하지 않도록 하는 디자인 패턴입니다.

이 패턴은 wallet 서비스의 Payment Provider 패턴을 참고하여 설계되었습니다.

## 핵심 원칙

### 1. Capability 기반 설계
각 Provider는 지원하는 기능(Capability)만 구현합니다.

```typescript
// ❌ 나쁜 예: 모든 Provider가 모든 메서드 구현 강제
interface StorageProvider {
  upload(): Promise<void>;
  delete(): Promise<void>;
  getSignedUrl(): Promise<string>;
  list(): Promise<string[]>;        // 모든 Provider가 지원하지 않음
  copy(): Promise<void>;            // 모든 Provider가 지원하지 않음
  generateThumbnail(): Promise<void>; // 일부만 지원
}

// ✅ 좋은 예: 각 Capability를 독립적인 Port로 분리
interface StorageUploadPort {
  upload(request: UploadRequest): Promise<UploadResult>;
}

interface StorageDeletePort {
  delete(request: DeleteRequest): Promise<void>;
}

interface StorageListPort {
  list(prefix: string): Promise<string[]>;
}
```

### 2. Interface Segregation Principle
큰 인터페이스를 작은 단위로 분리하여, Provider가 필요한 것만 구현합니다.

### 3. Registry 패턴
Registry가 Provider를 선택하고 Capability를 조합합니다.

## 아키텍처

```
┌─────────────────────────────────────────┐
│  상위 레이어 (UploadService 등)          │
│  - StorageService만 의존                 │
│  - 어떤 Provider인지 모름                │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  StorageService (Facade)                │
│  - Registry에 요청 위임                  │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  StorageProviderRegistry                │
│  - 환경변수로 Provider 선택              │
│  - Capability 조합                       │
└──────────────┬──────────────────────────┘
               ↓
    ┌──────────┴──────────┐
    ↓                     ↓
┌──────────┐        ┌──────────┐
│ S3       │        │ Local    │
│ Provider │        │ Provider │
└──────────┘        └──────────┘
```

## 구현 상세

### 1. Interface 정의

```typescript
// storage-provider.interface.ts

export enum StorageProviderType {
  S3 = 'S3',
  LOCAL = 'LOCAL',
  GCS = 'GCS',
}

// Request/Response 타입
export interface UploadRequest {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  success: boolean;
  key: string;
  url: string;
  provider: StorageProviderType;
}

// Capability Ports
export interface StorageUploadPort {
  upload(request: UploadRequest): Promise<UploadResult>;
}

export interface StorageDeletePort {
  delete(request: DeleteRequest): Promise<void>;
}

export interface StorageSignedUrlPort {
  getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult>;
}

// 선택적 Capabilities
export interface StorageListPort {
  list(prefix: string, maxKeys?: number): Promise<string[]>;
}

// Provider Handle (Capability 조합)
export type StorageProviderHandle = {
  id: StorageProviderType;
  upload: StorageUploadPort;
  delete: StorageDeletePort;
  signedUrl: StorageSignedUrlPort;
  list?: StorageListPort | null;    // 선택적
  copy?: StorageCopyPort | null;    // 선택적
};
```

### 2. Provider 구현

#### S3 Provider
```typescript
@Injectable()
export class S3StorageProvider
  implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort
{
  private s3Client: S3Client;

  async upload(request: UploadRequest): Promise<UploadResult> {
    // S3 업로드 구현
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: request.key,
      Body: request.buffer,
      ContentType: request.contentType,
    });

    await this.s3Client.send(command);

    return {
      success: true,
      key: request.key,
      url: `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${request.key}`,
      provider: StorageProviderType.S3,
    };
  }

  async delete(request: DeleteRequest): Promise<void> {
    // S3 삭제 구현
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    // S3 Signed URL 생성
  }
}
```

#### Local Provider
```typescript
@Injectable()
export class LocalStorageProvider
  implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort
{
  private readonly baseDir = path.join(process.cwd(), 'uploads');

  async upload(request: UploadRequest): Promise<UploadResult> {
    const filePath = path.join(this.baseDir, request.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, request.buffer);

    return {
      success: true,
      key: request.key,
      url: `http://localhost:3000/files/local/${request.key}`,
      provider: StorageProviderType.LOCAL,
    };
  }

  async delete(request: DeleteRequest): Promise<void> {
    // Local 파일 삭제
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    // Local에서는 실제 signed URL 대신 직접 URL 반환
    return {
      signedUrl: `http://localhost:3000/files/local/${request.key}`,
      expiresAt: new Date(Date.now() + request.expiresIn * 1000),
    };
  }
}
```

### 3. Registry 구현

```typescript
@Injectable()
export class StorageProviderRegistry {
  private readonly activeProvider: StorageProviderType;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Provider: S3StorageProvider,
    private readonly localProvider: LocalStorageProvider,
  ) {
    this.activeProvider = this.configService.get<StorageProviderType>(
      'STORAGE_PROVIDER',
      StorageProviderType.S3,
    );
  }

  getActive(): StorageProviderHandle {
    return this.get(this.activeProvider);
  }

  get(provider: StorageProviderType): StorageProviderHandle {
    switch (provider) {
      case StorageProviderType.S3:
        return {
          id: StorageProviderType.S3,
          upload: this.s3Provider,
          delete: this.s3Provider,
          signedUrl: this.s3Provider,
          list: null,      // S3는 list 미구현 (향후 추가 가능)
          copy: null,      // S3는 copy 미구현
        };

      case StorageProviderType.LOCAL:
        return {
          id: StorageProviderType.LOCAL,
          upload: this.localProvider,
          delete: this.localProvider,
          signedUrl: this.localProvider,
          list: null,      // Local은 list 미구현
          copy: null,
        };

      default:
        throw new Error(`Unknown storage provider: ${provider}`);
    }
  }
}
```

### 4. Facade Service

```typescript
@Injectable()
export class StorageService {
  constructor(private readonly registry: StorageProviderRegistry) {}

  async upload(request: UploadRequest): Promise<UploadResult> {
    const provider = this.registry.getActive();
    return provider.upload.upload(request);
  }

  async delete(request: DeleteRequest): Promise<void> {
    const provider = this.registry.getActive();
    return provider.delete.delete(request);
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    const provider = this.registry.getActive();
    return provider.signedUrl.getSignedUrl(request);
  }

  // 선택적 기능은 null 체크 필요
  async list(prefix: string): Promise<string[]> {
    const provider = this.registry.getActive();
    
    if (!provider.list) {
      throw new Error(`Provider ${provider.id} does not support list operation`);
    }

    return provider.list.list(prefix);
  }
}
```

## 사용 예시

### 상위 레이어에서 사용
```typescript
@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,  // ✅ Provider 모름
    private readonly pathBuilder: PathBuilderService,
  ) {}

  async uploadFile(file: Buffer, context: string, userId: string) {
    const fileId = uuidv7();
    const filePath = this.pathBuilder.buildPath({ context, fileId, ... });

    // ✅ 어떤 Provider인지 신경 안 씀
    const result = await this.storageService.upload({
      key: filePath,
      buffer: file,
      contentType: 'image/jpeg',
    });

    return result;
  }
}
```

## 장점

### 1. Provider 교체 용이
```bash
# 환경변수만 변경
STORAGE_PROVIDER=LOCAL  # 개발
STORAGE_PROVIDER=S3     # 프로덕션
```

### 2. 테스트 용이
```typescript
// Mock Provider 주입
const mockStorageService = {
  upload: jest.fn().mockResolvedValue({
    success: true,
    key: 'test/file.jpg',
    url: 'http://mock.url',
  }),
};
```

### 3. 점진적 기능 추가
```typescript
// 새로운 Provider 추가 시
// 1. Provider 클래스 생성
// 2. Registry에 등록
// 3. 기존 코드 변경 없음
```

### 4. 선택적 기능 구현
```typescript
// Provider마다 다른 기능 지원
S3: { upload: ✅, delete: ✅, list: ❌ }
GCS: { upload: ✅, delete: ✅, list: ✅ }
Cloudinary: { upload: ✅, delete: ✅, thumbnail: ✅ }
```

## 새로운 Provider 추가 방법

### 1. Provider 클래스 생성
```typescript
// providers/gcs-storage.provider.ts
@Injectable()
export class GcsStorageProvider
  implements StorageUploadPort, StorageDeletePort
{
  async upload(request: UploadRequest): Promise<UploadResult> {
    // GCS 업로드 구현
  }

  async delete(request: DeleteRequest): Promise<void> {
    // GCS 삭제 구현
  }
}
```

### 2. Registry에 등록
```typescript
export class StorageProviderRegistry {
  constructor(
    // ...
    private readonly gcsProvider: GcsStorageProvider,  // 주입
  ) {}

  get(provider: StorageProviderType): StorageProviderHandle {
    switch (provider) {
      // ...
      case StorageProviderType.GCS:
        return {
          id: StorageProviderType.GCS,
          upload: this.gcsProvider,
          delete: this.gcsProvider,
          signedUrl: null,  // 미지원
          list: null,
          copy: null,
        };
    }
  }
}
```

### 3. Module에 등록
```typescript
@Module({
  providers: [
    S3StorageProvider,
    LocalStorageProvider,
    GcsStorageProvider,  // 추가
    StorageProviderRegistry,
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
```

## Wallet Payment Provider 비교

| 항목 | Wallet (Payment) | File-Service (Storage) |
|------|------------------|------------------------|
| Provider 종류 | HMS_CARD, HMS_BNPL, TOSS | S3, LOCAL, GCS |
| Capability | charge, refund, cashReceipt | upload, delete, signedUrl |
| Registry | ProviderRegistry | StorageProviderRegistry |
| Facade | PaymentService (없음) | StorageService |
| 선택 메커니즘 | 비즈니스 로직에서 선택 | 환경변수로 선택 |

## 참고
- [Wallet Payment Provider](../../../wallet/src/providers/README.md)
- [Interface Segregation Principle](https://en.wikipedia.org/wiki/Interface_segregation_principle)

