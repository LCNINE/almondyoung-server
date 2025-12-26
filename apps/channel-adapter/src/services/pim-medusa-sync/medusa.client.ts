import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type {
    MedusaProductPayload,
    MedusaProduct,
} from '../../types';

@Injectable()
export class MedusaClient {
    private readonly logger = new Logger(MedusaClient.name);
    private readonly client: AxiosInstance;
    private readonly apiUrl: string;

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
            // - Secret API key starts with "sk_" -> x-medusa-access-token (raw sk token)
            if (apiKey.startsWith('ey')) {
                this.client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
            } else if (apiKey.startsWith('sk_')) {
                this.client.defaults.headers.common['x-medusa-access-token'] = apiKey;
            }
        }

        this.logger.log(`Medusa client initialized: ${this.apiUrl}`);
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
