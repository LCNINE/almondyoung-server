import { OutboundTenant } from '@app/tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { signFileServiceDelegation } from '../../../platform/auth/file-service-delegation';

// file-service 의 CUSTOMER_PRINT_FILE_CONTEXT_ID 와 같아야 한다
export const CUSTOMER_PRINT_FILE_CONTEXT = 'customer-print-file';

const TIMEOUT_MS = 10_000;

// 와우프레스는 링크를 받은 뒤 따로 내려받는다. ugc 인쇄 링크와 같은 5분이다
const LINK_EXPIRES_SEC = 300;

const described = z.object({ contextId: z.string(), uploadedBy: z.string(), status: z.string() });
const metadata = z.object({ originalName: z.string().min(1) });
const download = z.object({ signedUrl: z.string().min(1) });

// file-service 에 그 파일이 없다(지워졌거나 잘못된 id)
export class CustomerPrintFileNotFoundError extends Error {}

export interface CustomerPrintFile {
  ownerId: string;
  isPrintFile: boolean;
  fileName: string;
}

@Injectable()
export class CustomerPrintFileClient {
  constructor(
    private readonly config: ConfigService,
    @Inject(OutboundTenant) private readonly outboundTenant: Pick<OutboundTenant, 'headers' | 'tenantId'>,
  ) {}

  // 주인·용도는 내부 조회로만 알 수 있다. 위임 토큰으로는 주인이 아니어도 읽히므로 그것만으로 확인하지 않는다
  async describe(fileId: string, customerId: string): Promise<CustomerPrintFile> {
    const info = await this.internal(`/internal/files/${encodeURIComponent(fileId)}`, described);
    const meta = await this.delegated(`/files/${encodeURIComponent(fileId)}/metadata`, customerId, metadata);

    return {
      ownerId: info.uploadedBy,
      isPrintFile: info.contextId === CUSTOMER_PRINT_FILE_CONTEXT && info.status === 'active',
      fileName: meta.originalName,
    };
  }

  async link(fileId: string, customerId: string): Promise<string> {
    const res = await this.delegated(
      `/files/${encodeURIComponent(fileId)}/download?expiresIn=${LINK_EXPIRES_SEC}`,
      customerId,
      download,
    );

    return res.signedUrl;
  }

  private async internal<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const key = this.config.get<string>('FILE_SERVICE_INTERNAL_KEY');
    if (!key) {
      throw new Error('FILE_SERVICE_INTERNAL_KEY is not configured');
    }

    return this.get(path, `Bearer ${key}`, schema);
  }

  private async delegated<T>(path: string, customerId: string, schema: z.ZodType<T>): Promise<T> {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new Error('AUTH_SECRET is not configured');
    }
    const token = signFileServiceDelegation(secret, customerId, '1m', this.outboundTenant.tenantId());

    return this.get(path, `Bearer ${token}`, schema);
  }

  private async get<T>(path: string, authorization: string, schema: z.ZodType<T>): Promise<T> {
    const baseUrl = this.config.get<string>('FILE_SERVICE_URL');
    if (!baseUrl) {
      throw new Error('FILE_SERVICE_URL is not configured');
    }
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      headers: { Authorization: authorization, ...this.outboundTenant.headers() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      throw new CustomerPrintFileNotFoundError(`file-service ${path.split('?')[0]}: not found`);
    }
    if (!res.ok) {
      throw new Error(`file-service ${path.split('?')[0]} failed: HTTP ${res.status}`);
    }

    return schema.parse(await res.json());
  }
}
