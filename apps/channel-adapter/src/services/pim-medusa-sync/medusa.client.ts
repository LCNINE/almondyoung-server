import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type {
    MedusaProductPayload,
    MedusaProduct,
} from '../../types';
import type { PimCategoryDetail } from './pim.client';

@Injectable()
export class MedusaClient {
    private readonly logger = new Logger(MedusaClient.name);
    private readonly client: AxiosInstance;
    private readonly apiUrl: string;
    private readonly categoryCache = new Map<string, MedusaProduct['id']>(); // key: handle
    private readonly tagCache = new Map<string, string>(); // key: value
    private readonly typeCache = new Map<string, string>(); // key: value
    private readonly salesChannelCache = new Map<string, string>(); // key: name
    // 대용량 상품일 때 한번에 보내는 variants 수를 제한 (unknown_error 완화 목적)
    private readonly MAX_VARIANTS_PER_REQUEST = 30;

    constructor(private readonly configService: ConfigService) {
        this.apiUrl =
            this.configService.get<string>('MEDUSA_API_URL') || '';

        this.client = axios.create({
            baseURL: `${this.apiUrl}/admin`,
            headers: {
                'Content-Type': 'application/json',
            },
            // 대용량 variants/가격 동기화 시 타임아웃 및 바디 제한 확대
            timeout: 180000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        const apiKey = this.configService.get<string>('MEDUSA_API_KEY');
        if (apiKey) {
            // Medusa v2 admin auth:
            // - JWT starts with "ey" -> Bearer (Authorization)
            // - Secret API key starts with "sk_" -> Basic (Authorization) and x-medusa-access-token (best-effort)
            if (apiKey.startsWith('ey')) {
                this.client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
            } else if (apiKey.startsWith('sk_')) {
                /**
                 * Medusa admin secret key
                 * - Basic Auth expects base64("<token>:");
                 * - Also send x-medusa-access-token for compatibility.
                 */
                const basic = Buffer.from(`${apiKey}:`).toString('base64');
                this.client.defaults.headers.common['Authorization'] = `Basic ${basic}`;
                this.client.defaults.headers.common['x-medusa-access-token'] = apiKey;
                this.logger.log(
                    `Medusa admin API key detected (sk_... length=${apiKey.length}). Using Basic(base64) auth header.`,
                );
            }
        }

        this.logger.log(`Medusa client initialized: ${this.apiUrl}`);
    }

    // ===== Product Categories =====
    private normalizeCategoryListResponse(resp: any): any[] {
        return (
            resp?.data?.product_categories ||
            resp?.data?.productCategories ||
            resp?.data?.categories ||
            []
        );
    }

    private normalizeCategoryResponse(resp: any): any | null {
        return (
            resp?.data?.product_category ||
            resp?.data?.productCategory ||
            resp?.data?.category ||
            null
        );
    }

    private async findCategoryByHandle(handle: string): Promise<any | null> {
        try {
            const response = await this.client.get('/product-categories', {
                params: { handle },
            });
            const categories = this.normalizeCategoryListResponse(response);
            return categories.find((c: any) => c.handle === handle) || null;
        } catch (error) {
            this.logger.warn(
                `Medusa findCategoryByHandle failed for ${handle}: ${error.message}`,
            );
            return null;
        }
    }

    private async createCategory(payload: any): Promise<any> {
        const response = await this.client.post('/product-categories', payload);
        const created = this.normalizeCategoryResponse(response);
        if (!created) {
            throw new Error('Medusa API returned no category in response');
        }
        return created;
    }

    // 카테고리 보장: PIM 카테고리 트리를 따라 부모→자식 순서로 생성/조회
    async ensureCategoryTree(
        pimCategoryId: string,
        resolver: (id: string) => Promise<PimCategoryDetail>,
    ): Promise<string> {
        const handle = `${pimCategoryId}`;

        if (this.categoryCache.has(handle)) {
            return this.categoryCache.get(handle)!;
        }

        // 부모부터 보장
        const detail = await resolver(pimCategoryId);
        let parentMedusaId: string | undefined;
        const isActive =
            (detail.isActive ?? true) && (detail.visibility ?? true);
        const pimMetadata = {
            pimCategoryId: detail.id,
            pimPath: detail.path,
            pimSlug: detail.slug,
            pimVisibility: detail.visibility ?? true,
            pimShowOnMainCategory: detail.showOnMainCategory ?? false,
        };

        if (detail.parentId) {
            parentMedusaId = await this.ensureCategoryTree(
                detail.parentId,
                resolver,
            );
        }

        // 기존 조회
        const existing = await this.findCategoryByHandle(handle);
        if (existing?.id) {
            const updatePayload = {
                name: detail.name,
                is_internal: false,
                is_active: isActive,
                parent_category_id: parentMedusaId,
                metadata: {
                    ...(existing.metadata || {}),
                    ...pimMetadata,
                },
            };
            try {
                await this.client.post(
                    `/product-categories/${existing.id}`,
                    updatePayload,
                );
            } catch (err: any) {
                this.logger.warn(
                    `Failed to update Medusa category ${existing.id} from PIM ${detail.id}: ${err?.response?.data?.message || err?.message}`,
                );
            }
            this.categoryCache.set(handle, existing.id);
            return existing.id;
        }

        const payload = {
            name: detail.name,
            handle,
            is_internal: false,
            is_active: isActive,
            parent_category_id: parentMedusaId,
            metadata: {
                ...pimMetadata,
            },
        };

        const created = await this.createCategory(payload);
        this.categoryCache.set(handle, created.id);
        this.logger.log(
            `Created Medusa category ${created.id} for PIM category ${detail.id}`,
        );
        return created.id;
    }

    // 상품을 지정된 카테고리에 강제 매핑 (join 테이블 확실히 채우기)
    async attachProductToCategories(
        productId: string,
        categoryIds: string[],
        options?: { throwOnFailure?: boolean },
    ): Promise<void> {
        if (!categoryIds || categoryIds.length === 0) return;
        const unique = [...new Set(categoryIds)];
        for (const catId of unique) {
            try {
                // Medusa 버전에 따라 요구하는 필드명이 다를 수 있어 product_ids / add 순차 시도
                try {
                    await this.client.post(
                        `/product-categories/${catId}/products/batch`,
                        { product_ids: [productId] },
                    );
                    this.logger.debug(
                        `Attached product ${productId} to category ${catId} (product_ids)`,
                    );
                } catch (innerErr: any) {
                    this.logger.warn(
                        `product_ids payload failed for category ${catId}: ${innerErr?.response?.status} ${innerErr?.response?.data?.message || innerErr?.message}`,
                    );
                    await this.client.post(
                        `/product-categories/${catId}/products/batch`,
                        { add: [productId] },
                    );
                    this.logger.debug(
                        `Attached product ${productId} to category ${catId} (add)`,
                    );
                }
            } catch (error: any) {
                this.logger.warn(
                    `Failed to attach product ${productId} to category ${catId}: ${error?.response?.data?.message || error?.message}`,
                );
                if (options?.throwOnFailure) {
                    throw error;
                }
            }
        }
    }

    // ===== Product Tags =====
    private normalizeTagListResponse(resp: any): any[] {
        return (
            resp?.data?.product_tags ||
            resp?.data?.productTags ||
            resp?.data?.tags ||
            []
        );
    }

    private normalizeTagResponse(resp: any): any | null {
        return (
            resp?.data?.product_tag ||
            resp?.data?.productTag ||
            resp?.data?.tag ||
            null
        );
    }

    private async findTagByValue(value: string): Promise<any | null> {
        try {
            const response = await this.client.get('/product-tags', {
                params: { q: value },
            });
            const tags = this.normalizeTagListResponse(response);
            return tags.find((t: any) => t.value === value) || null;
        } catch (error) {
            this.logger.warn(
                `Medusa findTagByValue failed for ${value}: ${error.message}`,
            );
            return null;
        }
    }

    private async createTag(value: string): Promise<any> {
        const response = await this.client.post('/product-tags', { value });
        const created = this.normalizeTagResponse(response);
        if (!created) {
            throw new Error('Medusa API returned no tag in response');
        }
        return created;
    }

    async ensureTag(value: string): Promise<string> {
        if (!value) {
            throw new Error('Tag value is required');
        }

        if (this.tagCache.has(value)) {
            return this.tagCache.get(value)!;
        }

        const existing = await this.findTagByValue(value);
        if (existing?.id) {
            this.tagCache.set(value, existing.id);
            return existing.id;
        }

        const created = await this.createTag(value);
        this.tagCache.set(value, created.id);
        this.logger.log(`Created Medusa tag "${value}" (${created.id})`);
        return created.id;
    }

    async ensureProductType(value: string): Promise<string> {
        // 캐시 확인
        if (this.typeCache.has(value)) {
            return this.typeCache.get(value)!;
        }

        try {
            // 조회
            const response = await this.client.get('/product-types', {
                params: { q: value, limit: 1 }
            });

            const existing = response.data.product_types?.find((t: any) => t.value === value);
            if (existing) {
                this.typeCache.set(value, existing.id);
                return existing.id;
            }

            // 생성
            const createRes = await this.client.post('/product-types', {
                value,
            });
            const newId = createRes.data.product_type.id;
            this.typeCache.set(value, newId);
            this.logger.log(`Created Medusa product type "${value}" (${newId})`);
            return newId;

        } catch (error) {
            this.logger.error(
                `Failed to ensure product type ${value}: ${JSON.stringify(error.response?.data || error.message)}`
            );
            // 실패 시 빈 문자열 반환하거나 에러 throw (여기선 에러 throw)
            throw new Error(`Medusa ensureProductType failed: ${error.message}`);
        }
    }

    async ensureTags(values: string[]): Promise<Array<{ id: string; value: string }>> {
        const results: Array<{ id: string; value: string }> = [];
        for (const value of values) {
            const id = await this.ensureTag(value);
            results.push({ id, value });
        }
        return results;
    }

    async getDefaultSalesChannel(): Promise<string> {
        try {
            // 캐시 확인
            if (this.salesChannelCache.has('Default Sales Channel')) {
                return this.salesChannelCache.get('Default Sales Channel')!;
            }

            const response = await this.client.get('/sales-channels', {
                params: { q: 'Default Sales Channel', limit: 1 }
            });

            const channel = response.data.sales_channels?.[0];
            if (channel) {
                this.salesChannelCache.set('Default Sales Channel', channel.id);
                return channel.id;
            }

            // 없으면 생성 (혹은 에러 처리)
            this.logger.warn('Default Sales Channel not found, creating...');
            const createRes = await this.client.post('/sales-channels', {
                name: 'Default Sales Channel',
                description: 'Created by Medusa'
            });
            const newId = createRes.data.sales_channel.id;
            this.salesChannelCache.set('Default Sales Channel', newId);
            return newId;

        } catch (error) {
            this.logger.error(
                `Failed to get default sales channel: ${JSON.stringify(error.response?.data || error.message)}`
            );
            throw new Error(`Medusa getDefaultSalesChannel failed: ${error.message}`);
        }
    }

    // handle로 medusa product 조회
    async findProductByHandle(
        handle: string,
    ): Promise<MedusaProduct | null> {
        try {
            this.logger.debug(`Finding Medusa product by handle: ${handle}`);

            // Medusa는 handle 기반 조회를 공식 지원
            const response = await this.client.get(`/products`, {
                params: {
                    handle,
                    limit: 1,
                },
            });

            const products = response.data?.products || [];
            if (products.length === 0) {
                this.logger.debug(`No Medusa product found for handle: ${handle}`);
                return null;
            }

            const product = products[0];
            this.logger.debug(
                `Found Medusa product: ${product.id} (handle: ${product.handle})`,
            );
            return product;
        } catch (error) {
            this.logger.error(
                `Failed to find product by handle: ${handle}`,
                error.stack,
            );
            throw new Error(`Medusa findProductByHandle failed: ${error.message}`);
        }
    }

    // medusa product 생성
    async createProduct(
        payload: MedusaProductPayload,
    ): Promise<MedusaProduct> {
        try {
            this.logger.log(`Creating Medusa product: ${payload.title} (${payload.handle})`);

            const response = await this.client.post('/products', payload);

            const product = response.data?.product;
            if (!product) {
                throw new Error('Medusa API returned no product in response');
            }

            this.logger.log(
                `Created Medusa product: ${product.id} (${product.handle})`,
            );
            return product;
        } catch (error) {
            this.logger.error(
                `Failed to create Medusa product: ${payload.title}`,
                error.response?.data || error.stack,
            );
            throw new Error(`Medusa createProduct failed: ${error.message}`);
        }
    }

    // 대용량 variant를 나눠서 생성
    private async createProductChunked(
        payload: MedusaProductPayload,
    ): Promise<MedusaProduct> {
        const variants = payload.variants || [];
        if (variants.length <= this.MAX_VARIANTS_PER_REQUEST) {
            return this.createProduct(payload);
        }

        // 1) 첫 variant만 넣어 product 생성
        const [firstVariant, ...rest] = variants;
        const created = await this.createProduct({
            ...payload,
            variants: [firstVariant],
        });

        try {
            // 2) 나머지 variants는 작은 청크로 추가
            const chunkSize = 10;
            for (let i = 0; i < rest.length; i += chunkSize) {
                const chunk = rest.slice(i, i + chunkSize);
                await this.addVariants(created.id, chunk);
            }
        } catch (err) {
            // 부분 생성 방지: 추가 중 실패하면 생성한 상품을 롤백
            this.logger.error(
                `Failed to add variants for product ${created.id}, rolling back create.`,
                err?.response?.data || err?.message,
            );
            await this.safeDeleteProduct(created.id);
            throw err;
        }

        // 3) 최신 product 리턴 (variant id 매핑 위해 조회)
        return this.getProduct(created.id);
    }

    private async addVariants(productId: string, variants: any[]): Promise<void> {
        for (const variant of variants) {
            await this.client.post(`/products/${productId}/variants`, variant);
        }
    }

    private async getProduct(productId: string): Promise<MedusaProduct> {
        const res = await this.client.get(`/products/${productId}`);
        return res.data?.product;
    }

    private async safeDeleteProduct(productId: string): Promise<void> {
        try {
            await this.deleteProduct(productId);
        } catch (e) {
            this.logger.warn(
                `Failed to rollback product ${productId} after variant add error: ${e?.message}`,
            );
        }
    }

    // medusa product 업데이트
    async updateProduct(
        medusaProductId: string,
        payload: Partial<MedusaProductPayload>,
    ): Promise<MedusaProduct> {
        try {
            this.logger.log(`Updating Medusa product: ${medusaProductId}`);

            const response = await this.client.post(
                `/products/${medusaProductId}`,
                payload,
            );

            const product = response.data?.product;
            if (!product) {
                throw new Error('Medusa API returned no product in response');
            }

            this.logger.log(
                `Updated Medusa product: ${product.id} (${product.handle})`,
            );
            return product;
        } catch (error: any) {
            this.logger.error(
                `Failed to update Medusa product: ${medusaProductId}`,
                error?.response?.data || error?.stack,
            );
            // Re-throw original error so caller can inspect status/type and decide fallback (create)
            throw error;
        }
    }

    // upsert: medusaProductId가 있으면 update, 없으면 create
    // (mapping repository가 제공한 medusaProductId 사용)
    async upsertProduct(
        payload: MedusaProductPayload,
        medusaProductId?: string,
    ): Promise<{ product: MedusaProduct; action: 'created' | 'updated' }> {
        if (medusaProductId) {
            try {
                // 매핑이 있으면 업데이트
                const product = await this.updateProduct(medusaProductId, payload);
                return { product, action: 'updated' };
            } catch (err: any) {
                // 이전에 존재하던 product id가 삭제되었을 경우 create로 재시도
                const errType = err?.response?.data?.type;
                const status = err?.response?.status;
                const is404 =
                    errType === 'not_found' ||
                    status === 404 ||
                    /status code 404/i.test(err?.message || '');
                if (is404) {
                    this.logger.warn(
                        `Medusa product ${medusaProductId} not found. Recreating with handle ${payload.handle}`,
                    );
                } else {
                    throw err;
                }
            }
        }

        // 매핑이 없으면 handle로 조회 (혹시 매핑 테이블과 실제 상태가 다른 경우 복구)
        const existingProduct = await this.findProductByHandle(payload.handle);
        if (existingProduct) {
            this.logger.warn(
                `Found product by handle without mapping: ${payload.handle} -> ${existingProduct.id}. Updating.`,
            );
            const product = await this.updateProduct(existingProduct.id, payload);
            return { product, action: 'updated' };
        }

        // 완전히 새 상품
        const product = await this.createProductChunked(payload);
        return { product, action: 'created' };
    }

    // medusa product를 draft로 전환 (unpublished 처리 - P1 권장사항)
    async setProductToDraft(medusaProductId: string): Promise<void> {
        try {
            this.logger.log(`Setting Medusa product to draft: ${medusaProductId}`);

            await this.client.post(`/products/${medusaProductId}`, {
                status: 'draft',
            });

            this.logger.log(`Set product to draft: ${medusaProductId}`);
        } catch (error) {
            this.logger.error(
                `Failed to set product to draft: ${medusaProductId}`,
                error.response?.data || error.stack,
            );
            throw new Error(`Medusa setProductToDraft failed: ${error.message}`);
        }
    }

    // medusa product 삭제 (주의: 장바구니/주문 참조 깨질 수 있음)
    async deleteProduct(medusaProductId: string): Promise<void> {
        try {
            this.logger.warn(`Deleting Medusa product: ${medusaProductId}`);

            await this.client.delete(`/products/${medusaProductId}`);

            this.logger.log(`Deleted Medusa product: ${medusaProductId}`);
        } catch (error) {
            this.logger.error(
                `Failed to delete Medusa product: ${medusaProductId}`,
                error.response?.data || error.stack,
            );
            throw new Error(`Medusa deleteProduct failed: ${error.message}`);
        }
    }

    // 헬스 체크: medusa api 연결 확인
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.client.get('/products', {
                params: { limit: 1 },
            });
            return response.status === 200;
        } catch (error) {
            this.logger.error('Medusa health check failed', error.message);
            return false;
        }
    }

    // ===== Price Lists =====
    async ensurePriceList(payload: {
        name: string;
        description: string;
        type: 'sale' | 'override';
        status: 'active' | 'draft';
        rules?: Record<string, string[]>;
    }): Promise<string> {
        try {
            // 1. 이름으로 기존 Price List 조회
            const searchRes = await this.client.get('/price-lists', {
                params: { q: payload.name, limit: 1 },
            });
            const existing = searchRes.data?.price_lists?.find(
                (pl: any) => pl.name === payload.name
            );

            if (existing) {
                // 업데이트 (필요시)
                if (existing.status !== payload.status) {
                    await this.client.post(`/price-lists/${existing.id}`, {
                        status: payload.status,
                    });
                }
                return existing.id;
            }

            // 2. 생성
            const createPayload = {
                title: payload.name,
                description: payload.description,
                type: payload.type,
                status: payload.status,
                prices: [],
                rules: payload.rules,
            };
            this.logger.debug(`Creating Price List: ${JSON.stringify(createPayload)}`);

            const createRes = await this.client.post('/price-lists', createPayload);

            return createRes.data.price_list.id;
        } catch (error) {
            this.logger.error(
                `Failed to ensure price list ${payload.name}: ${JSON.stringify(error.response?.data || error.message)}`
            );
            throw new Error(`Medusa ensurePriceList failed: ${error.message}`);
        }
    }

    async addPricesToPriceList(
        priceListId: string,
        prices: Array<{
            amount: number;
            currency_code: string;
            variant_id: string;
            min_quantity?: number;
            max_quantity?: number;
        }>
    ): Promise<void> {
        try {
            this.logger.debug(`Adding prices to list ${priceListId}: ${JSON.stringify({ create: prices })}`);
            // Medusa v2 Admin API: POST /admin/price-lists/:id/prices/batch
            await this.client.post(`/price-lists/${priceListId}/prices/batch`, {
                create: prices,
            });
            this.logger.log(`Added ${prices.length} prices to list ${priceListId}`);
        } catch (error) {
            this.logger.error(
                `Failed to add prices to list ${priceListId}: ${JSON.stringify(error.response?.data || error.message)}`
            );
            throw new Error(`Medusa addPricesToPriceList failed: ${error.message}`);
        }
    }
}
