import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

const DESIGN_TIMEOUT_MS = 10_000;
const PRINT_LINK_TIMEOUT_MS = 120_000;

const designInfo = z.object({
  userId: z.string(),
  productId: z.string(),
  widthMm: z.number(),
  heightMm: z.number(),
  hasBack: z.boolean(),
});
const printLinkInfo = z.object({ url: z.string().min(1), fileName: z.string().min(1) });

export type UgcAlmondDesignInfo = z.infer<typeof designInfo>;
export type UgcPrintLink = z.infer<typeof printLinkInfo>;

@Injectable()
export class UgcAlmondDesignClient {
  constructor(private readonly config: ConfigService) {}

  design(id: string): Promise<UgcAlmondDesignInfo> {
    return this.get(`/internal/almond-designs/${encodeURIComponent(id)}`, DESIGN_TIMEOUT_MS, designInfo);
  }

  printLink(id: string, format: 'jpg' | 'pdf' | 'eps', dpi: number): Promise<UgcPrintLink> {
    const query = new URLSearchParams({ format, dpi: String(dpi) });
    return this.get(
      `/internal/almond-designs/${encodeURIComponent(id)}/print-link?${query.toString()}`,
      PRINT_LINK_TIMEOUT_MS,
      printLinkInfo,
    );
  }

  private async get<T>(path: string, timeoutMs: number, schema: z.ZodType<T>): Promise<T> {
    const baseUrl = this.config.get<string>('UGC_SERVICE_URL');
    const key = this.config.get<string>('UGC_INTERNAL_KEY');
    if (!baseUrl || !key) throw new Error('UGC_SERVICE_URL/UGC_INTERNAL_KEY is not configured');
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ugc ${path.split('?')[0]} failed: HTTP ${res.status}`);
    return schema.parse(await res.json());
  }
}
