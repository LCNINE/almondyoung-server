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

export interface DirectUploadRequest {
  key: string;
  contentType: string;
  isPublic: boolean;
  expiresIn: number;
}

export interface DirectUploadResult {
  provider: StorageProviderType;
  uploadUrl: string;
  // 클라이언트가 PUT 요청에 실어야 하는 헤더 (예: 저장될 객체 메타데이터용 Content-Type)
  headers: Record<string, string>;
  // 업로드 완료 후 객체가 서빙될 최종 URL (uploads.url 에 저장)
  fileUrl: string;
  expiresAt: Date;
}

export interface HeadObjectRequest {
  key: string;
  isPublic?: boolean;
}

export interface HeadObjectResult {
  size: number;
  contentType?: string;
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

/**
 * 브라우저가 스토리지에 직접 PUT 하는 업로드(presigned PUT). 프록시(Lambda) 본문
 * 상한을 우회하는 경로라, 서버를 거치지 않고 올라간 객체를 확인할 head 도 함께 요구한다.
 * LOCAL 처럼 직접 PUT 을 받아줄 수 없는 프로바이더는 이 포트를 구현하지 않는다.
 */
export interface StorageDirectUploadPort {
  createDirectUpload(request: DirectUploadRequest): Promise<DirectUploadResult>;
  /** 객체가 없으면 null */
  headObject(request: HeadObjectRequest): Promise<HeadObjectResult | null>;
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
  directUpload?: StorageDirectUploadPort | null;
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
