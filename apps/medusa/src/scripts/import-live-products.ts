/**
 * 로컬 Medusa 에 라이브 상품을 채워 넣는다 — 로컬 DB 복제본이 뒤처져서 최근 라이브 상품이
 * 없을 때 쓴다. 입력은 라이브 Store API 응답을 그대로 담은 JSON 배열.
 *
 *   IMPORT_FILE=/path/to/live_products.json npx medusa exec ./src/scripts/import-live-products.ts
 *
 * 이미 같은 handle 이 있으면 건너뛴다. 로컬에 없는 카테고리·태그는 버린다.
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createProductsWorkflow } from '@medusajs/medusa/core-flows';
import { promises as fs } from 'node:fs';

interface LiveProduct {
  handle: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  status?: string;
  thumbnail?: string | null;
  images?: Array<{ url: string }>;
  options?: Array<{ title: string; values?: Array<{ value: string }> }>;
  variants?: Array<Record<string, any>>;
  categories?: Array<{ id: string }>;
  tags?: Array<{ value: string }>;
  metadata?: Record<string, unknown> | null;
}

export default async function importLiveProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const file = process.env.IMPORT_FILE;
  if (!file) throw new Error('IMPORT_FILE 이 필요하다');
  const products: LiveProduct[] = JSON.parse(await fs.readFile(file, 'utf8'));

  const { data: channels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  });
  const salesChannelId = channels[0]?.id;
  if (!salesChannelId) throw new Error('sales channel 이 없다');

  const { data: profiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  });
  const shippingProfileId = profiles[0]?.id;

  const { data: localCategories } = await query.graph({
    entity: 'product_category',
    fields: ['id'],
  });
  const knownCategories = new Set(localCategories.map((c: any) => c.id));

  const { data: existing } = await query.graph({
    entity: 'product',
    fields: ['handle'],
    filters: { handle: products.map((p) => p.handle) },
  });
  const alreadyThere = new Set(existing.map((p: any) => p.handle));

  const inputs = products
    .filter((p) => !alreadyThere.has(p.handle))
    .map((p) => {
      const optionTitles = (p.options ?? []).map((o) => o.title);
      return {
        title: p.title,
        handle: p.handle,
        subtitle: p.subtitle ?? undefined,
        description: p.description ?? undefined,
        status: 'published',
        thumbnail: p.thumbnail ?? undefined,
        images: (p.images ?? []).map((i) => ({ url: i.url })),
        options:
          optionTitles.length > 0
            ? p.options!.map((o) => ({
                title: o.title,
                values: (o.values ?? []).map((v) => v.value),
              }))
            : [{ title: '기본 옵션', values: ['기본'] }],
        variants: (p.variants ?? []).map((v) => ({
          title: v.title ?? '기본',
          sku: v.sku ?? undefined,
          barcode: v.barcode ?? undefined,
          manage_inventory: v.manage_inventory ?? false,
          allow_backorder: v.allow_backorder ?? false,
          weight: v.weight ?? undefined,
          metadata: v.metadata ?? undefined,
          options: Object.fromEntries(
            (v.options ?? []).map((o: any) => [
              o.option?.title ?? optionTitles[0] ?? '기본 옵션',
              o.value,
            ])
          ),
          prices: (v.prices ?? []).map((pr: any) => ({
            amount: pr.amount,
            currency_code: pr.currency_code,
          })),
        })),
        category_ids: (p.categories ?? [])
          .map((c) => c.id)
          .filter((id) => knownCategories.has(id)),
        metadata: p.metadata ?? undefined,
        sales_channels: [{ id: salesChannelId }],
        ...(shippingProfileId ? { shipping_profile_id: shippingProfileId } : {}),
      };
    });

  logger.info(
    `[import] 대상 ${inputs.length}건 (이미 있음 ${alreadyThere.size}건)`
  );

  let ok = 0;
  const failures: Array<{ handle: string; error: string }> = [];
  for (const input of inputs) {
    try {
      await createProductsWorkflow(container).run({
        input: { products: [input as any] },
      });
      ok += 1;
    } catch (err: any) {
      failures.push({ handle: input.handle, error: err?.message ?? String(err) });
    }
  }

  logger.info(`[import] 완료 ${ok}건, 실패 ${failures.length}건`);
  for (const f of failures.slice(0, 10)) {
    logger.error(`[import] ${f.handle}: ${f.error}`);
  }
}
