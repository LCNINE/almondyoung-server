import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

const componentSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
  availableQuantity: z.number().int().nonnegative(),
});

const itemSchema = z.object({
  variantId: z.string().uuid(),
  masterId: z.string().uuid(),
  versionId: z.string().uuid(),
  skuId: z.string().uuid(),
  sku: z.string().min(1),
  productName: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  availableQuantity: z.number().int().nonnegative(),
  components: z.array(componentSchema).min(1),
});

const pageSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});

export type DemoCatalogItem = z.infer<typeof itemSchema>;

export interface DemoCatalogQuery {
  variantIds?: string[];
  randomSeed?: string;
  availableOnly?: boolean;
}

@Injectable()
export class DemoCatalogClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    const configuredUrl = config.get<string>('PIM_API_URL');
    if (!configuredUrl) throw new Error('PIM_API_URL is required for demo catalog access');
    const parsed = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('PIM_API_URL must use http or https');
    }
    this.baseUrl = configuredUrl.replace(/\/$/, '');
  }

  async list(query: DemoCatalogQuery, authorization: string): Promise<DemoCatalogItem[]> {
    const params: Record<string, string | number | boolean> = { page: 1, limit: 100 };
    if (query.variantIds?.length) params.variantIds = query.variantIds.join(',');
    if (query.randomSeed) params.randomSeed = query.randomSeed;
    if (query.availableOnly !== undefined) params.availableOnly = query.availableOnly;

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.baseUrl}/demo/catalog`, {
        params,
        headers: { Authorization: authorization },
        timeout: 5000,
      }),
    );
    const body = response.data as { data?: unknown };
    const parsed = pageSchema.safeParse(body?.data ?? body);
    if (!parsed.success) {
      throw new Error(`Invalid demo catalog response: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`);
    }
    return parsed.data.items;
  }
}
