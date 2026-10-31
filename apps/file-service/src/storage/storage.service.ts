import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { sharedBucketsOf } from './local-storage.path';

type Unlocated<T> = Omit<T, 'bucket'>;

/**
 * 스토리지 진입점. 호출자는 파일의 테넌트만 넘기고, 버킷은 여기서 테넌트 목록의 그 테넌트 항목으로 정한다
 * (`isPublic` 으로 공개·비공개). 버킷 이름은 코드에 없다.
 *
 * 테넌트가 `null` 이면(① 의 테넌트 모르는 쓰기와 그 행) 테넌트 전 버킷 env(`AWS_S3_*_BUCKET`) — core 가 ① 에서
 * `DATABASE_URL` 하나를 쓰는 것과 같은 자리다. 라이브에선 그 값이 테넌트 1 의 버킷과 같다.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly registry: StorageProviderRegistry,
    private readonly tenancy: TenancyConfig,
    private readonly config: ConfigService,
  ) {
    assertLegacyBucketsShared(tenancy, config);
  }

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
    if (tenant === null) return this.config.get<string>(isPublic ? 'AWS_S3_PUBLIC_BUCKET' : 'AWS_S3_PRIVATE_BUCKET');
    const entry = this.tenancy.tenants.find(tenant);
    // 문이 목록과 대조한 값이거나 행에 적힌 값이다 — 여기 오면 목록에서 테넌트가 빠진 것이다.
    if (!entry) throw new Error(`file-service: 테넌트 «${tenant}» 가 테넌트 목록에 없어 버킷을 모른다`);
    return isPublic ? entry.publicBucket : entry.privateBucket;
  }
}

/**
 * 테넌트 전 버킷 env 는 목록의 공용 버킷(테넌트 1 의 것)이어야 한다. ① 의 테넌트 모르는 쓰기는 env 버킷에 들어가고
 * 행은 DB 기본값(테넌트 1)을 받아 되읽기·서명·삭제가 목록의 그 버킷으로 간다 — 둘이 갈리면 그 파일은 조용히
 * 사라진 것처럼 된다. 그래서 부팅에서 거부한다. env 가 없으면(LOCAL) 검사할 것이 없다.
 */
function assertLegacyBucketsShared(tenancy: TenancyConfig, config: ConfigService): void {
  const shared = sharedBucketsOf(tenancy.tenants);
  for (const name of ['AWS_S3_PUBLIC_BUCKET', 'AWS_S3_PRIVATE_BUCKET']) {
    const bucket = config.get<string>(name);
    // 버킷 이름은 비공개 값이라 메시지에 싣지 않는다(tenant-list.ts 와 같은 규칙).
    if (bucket && !shared.has(bucket)) {
      throw new Error(`file-service: ${name} 가 테넌트 목록의 공용 버킷(publicBucket = privateBucket)이 아니다`);
    }
  }
}
