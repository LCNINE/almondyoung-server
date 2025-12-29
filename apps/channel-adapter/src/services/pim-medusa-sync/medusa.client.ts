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

    constructor(private readonly configService: ConfigService) {
        this.apiUrl =
            this.configService.get<string>('MEDUSA_API_URL') || '';

        this.client = axios.create({
            baseURL: `${this.apiUrl}/admin`,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });

        const apiKey = this.configService.get<string>('MEDUSA_API_KEY');
        if (apiKey) {
            // Medusa v2 admin auth:
            // - JWT starts with "ey" -> Bearer (Authorization)
            // - Secret API key starts with "sk_" -> Basic (Authorization) and x-medusa-access-token (best-effort)
            if (apiKey.startsWith('ey')) {
                this.client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
            } else if (apiKey.startsWith('sk_')) {
                // Medusa's authenticate-middleware expects Basic with the raw sk token (base64 optional)
                this.client.defaults.headers.common['Authorization'] = `Basic ${apiKey}`;
                // Also send x-medusa-access-token for compatibility (ignored if not needed)
                this.client.defaults.headers.common['x-medusa-access-token'] = apiKey;
                this.logger.log(
                    `Medusa admin API key detected (sk_... length=${apiKey.length}). Using Basic auth header.`,
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

    /**
     * 카테고리 보장: PIM 카테고리 트리를 따라 부모→자식 순서로 생성/조회
     * handle: pim-cat-{pimCategoryId}
     */
    async ensureCategoryTree(
        pimCategoryId: string,
        resolver: (id: string) => Promise<PimCategoryDetail>,
    ): Promise<string> {
        const handle = `pim-cat-${pimCategoryId}`;

        if (this.categoryCache.has(handle)) {
            return this.categoryCache.get(handle)!;
        }

        // 부모부터 보장
        const detail = await resolver(pimCategoryId);
        let parentMedusaId: string | undefined;

        if (detail.parentId) {
            parentMedusaId = await this.ensureCategoryTree(
                detail.parentId,
                resolver,
            );
        }

        // 기존 조회
        const existing = await this.findCategoryByHandle(handle);
        if (existing?.id) {
            this.categoryCache.set(handle, existing.id);
            return existing.id;
        }

        const payload = {
            name: detail.name,
            handle,
            is_internal: false,
            is_active: detail.isActive !== false,
            parent_category_id: parentMedusaId,
            metadata: {
                pimCategoryId: detail.id,
                pimPath: detail.path,
            },
        };

        const created = await this.createCategory(payload);
        this.categoryCache.set(handle, created.id);
        this.logger.log(
            `Created Medusa category ${created.id} for PIM category ${detail.id}`,
        );
        return created.id;
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

    async ensureTags(values: string[]): Promise<Array<{ id: string; value: string }>> {
        const results: Array<{ id: string; value: string }> = [];
        for (const value of values) {
            const id = await this.ensureTag(value);
            results.push({ id, value });
        }
        return results;
    }

    // handle로 medusa product 조회 (handle = pim-{masterId})
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
        } catch (error) {
            this.logger.error(
                `Failed to update Medusa product: ${medusaProductId}`,
                error.response?.data || error.stack,
            );
            throw new Error(`Medusa updateProduct failed: ${error.message}`);
        }
    }

    // upsert: medusaProductId가 있으면 update, 없으면 create
    // (mapping repository가 제공한 medusaProductId 사용)
    async upsertProduct(
        payload: MedusaProductPayload,
        medusaProductId?: string,
    ): Promise<{ product: MedusaProduct; action: 'created' | 'updated' }> {
        if (medusaProductId) {
            // 매핑이 있으면 업데이트
            const product = await this.updateProduct(medusaProductId, payload);
            return { product, action: 'updated' };
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
        const product = await this.createProduct(payload);
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
}
