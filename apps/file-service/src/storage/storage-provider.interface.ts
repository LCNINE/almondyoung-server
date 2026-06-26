// Storage Provider Interface - Capability-based abstraction layer

export enum StorageProviderType {
  S3 = 'S3',
  LOCAL = 'LOCAL',
  GCS = 'GCS',
  AZURE_BLOB = 'AZURE_BLOB',
}

// ────────────────────── Request/Response Types ──────────────────────

export interface UploadRequest {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
  isPublic?: boolean;
}

export interface UploadResult {
  success: boolean;
  key: string;
  url: string;
  provider: StorageProviderType;
  isPublic: boolean;
  metadata?: {
    etag?: string;
    versionId?: string;
    bucket?: string;
  };
}

export interface DeleteRequest {
  key: string;
  isPublic?: boolean;
}

export interface SignedUrlRequest {
  key: string;
  expiresIn: number;
  operation?: 'get' | 'put';
  isPublic?: boolean;
  // GET presign 시 S3 ResponseContentDisposition 으로 강제 다운로드/파일명 지정 (예: attachment; filename*=UTF-8''..)
  responseContentDisposition?: string;
}

export interface SignedUrlResult {
  signedUrl: string;
  expiresAt: Date;
}

// ────────────────────── Capability Ports ──────────────────────

export interface StorageUploadPort {
  upload(request: UploadRequest): Promise<UploadResult>;
}

export interface StorageDeletePort {
  delete(request: DeleteRequest): Promise<void>;
}

export interface StorageSignedUrlPort {
  getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult>;
}

export interface StorageListPort {
  list(prefix: string, maxKeys?: number): Promise<string[]>;
}

export interface StorageCopyPort {
  copy(sourceKey: string, destKey: string): Promise<void>;
}

// ────────────────────── Provider Handle ──────────────────────

export type StorageProviderHandle = {
  id: StorageProviderType;
  upload: StorageUploadPort;
  delete: StorageDeletePort;
  signedUrl: StorageSignedUrlPort;
  list?: StorageListPort | null;
  copy?: StorageCopyPort | null;
};

// ────────────────────── Error Class ──────────────────────

export class StorageError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
