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
}

export interface UploadResult {
  success: boolean;
  key: string;
  url: string;
  provider: StorageProviderType;
  metadata?: {
    etag?: string;
    versionId?: string;
  };
}

export interface DeleteRequest {
  key: string;
}

export interface SignedUrlRequest {
  key: string;
  expiresIn: number;
  operation?: 'get' | 'put';
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

