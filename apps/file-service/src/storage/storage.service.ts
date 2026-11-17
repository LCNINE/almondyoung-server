import { Injectable } from '@nestjs/common';
import { TenancyConfig } from '@app/tenancy';
import { StorageProviderRegistry } from './storage-provider.registry';
import {
  UploadRequest,
  UploadResult,
  DeleteRequest,
  SignedUrlRequest,
  SignedUrlResult,
  DirectUploadRequest,
  DirectUploadResult,
  HeadObjectRequest,
  HeadObjectResult,
} from './storage-provider.interface';
import type { RequestTenantId } from '../tenancy/request-tenant';

type Unlocated<T> = Omit<T, 'bucket'>;

/**
 * 스토리지 진입점. 호출자는 파일의 테넌트만 넘기고, 버킷은 여기서 테넌트 목록의 그 테넌트 항목으로 정한다
 * (`isPublic` 으로 공개·비공개). 버킷 이름은 코드에 없다. 테넌트 전 버킷(env)은 없다 — 모든 파일에 테넌트가 있다.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly registry: StorageProviderRegistry,
    private readonly tenancy: TenancyConfig,
  ) {}

  async upload(tenant: RequestTenantId, request: Unlocated<UploadRequest>): Promise<UploadResult> {
    return this.registry.getActive().upload.upload(this.located(tenant, request));
  }

  async delete(tenant: RequestTenantId, request: Unlocated<DeleteRequest>): Promise<void> {
    return this.registry.getActive().delete.delete(this.located(tenant, request));
  }

  async getSignedUrl(tenant: RequestTenantId, request: Unlocated<SignedUrlRequest>): Promise<SignedUrlResult> {
    return this.registry.getActive().signedUrl.getSignedUrl(this.located(tenant, request));
  }

  /** 활성 프로바이더가 브라우저 직접 업로드를 받는가. 아니면 클라이언트는 프록시 업로드로 폴백한다. */
  supportsDirectUpload(): boolean {
    return !!this.registry.getActive().directUpload;
  }

  async createDirectUpload(
    tenant: RequestTenantId,
    request: Unlocated<DirectUploadRequest>,
  ): Promise<DirectUploadResult> {
    return this.directPort().createDirectUpload(this.located(tenant, request));
  }

  /** 객체가 없으면 null */
  async headObject(tenant: RequestTenantId, request: Unlocated<HeadObjectRequest>): Promise<HeadObjectResult | null> {
    return this.directPort().headObject(this.located(tenant, request));
  }

  private directPort() {
    const port = this.registry.getActive().directUpload;
    if (!port) throw new Error('활성 스토리지 프로바이더가 직접 업로드를 지원하지 않는다');
    return port;
  }

  private located<T extends { isPublic?: boolean }>(
    tenant: RequestTenantId,
    request: T,
  ): T & { bucket: string | undefined } {
    return { ...request, bucket: this.bucketOf(tenant, request.isPublic ?? false) };
  }

  private bucketOf(tenant: RequestTenantId, isPublic: boolean): string | undefined {
    const entry = this.tenancy.tenants.find(tenant);
    // 문이 목록과 대조한 값이거나 행에 적힌 값이다 — 여기 오면 목록에서 테넌트가 빠진 것이다.
    if (!entry) throw new Error(`file-service: 테넌트 «${tenant}» 가 테넌트 목록에 없어 버킷을 모른다`);
    return isPublic ? entry.publicBucket : entry.privateBucket;
  }
}
