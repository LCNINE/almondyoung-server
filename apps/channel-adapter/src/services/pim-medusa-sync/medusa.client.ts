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
            this.client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
        }

        this.logger.log(`Medusa client initialized: ${this.apiUrl}`);
    }

    // pim master id로 medusa product 조회
    async findProductByPimMasterId(
        pimMasterId: string,
    ): Promise<MedusaProduct | null> {
        try {
            this.logger.debug(`Finding Medusa product by PIM masterId: ${pimMasterId}`);

            const response = await this.client.get('/products', {
                params: {
                    'metadata[pimMasterId]': pimMasterId,
                    limit: 1,
                },
            });

            const products = response.data?.products || [];
            if (products.length === 0) {
                this.logger.debug(`No Medusa product found for PIM masterId: ${pimMasterId}`);
                return null;
            }

            const product = products[0];
            this.logger.debug(
                `Found Medusa product: ${product.id} (handle: ${product.handle})`,
            );
            return product;
        } catch (error) {
            this.logger.error(
                `Failed to find product by PIM masterId: ${pimMasterId}`,
                error.stack,
            );
            throw new Error(`Medusa findProductByPimMasterId failed: ${error.message}`);
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

    // upsert: pim master id로 medusa product 조회 후 자동으로 생성/업데이트 선택
    async upsertProduct(
        payload: MedusaProductPayload,
    ): Promise<{ product: MedusaProduct; action: 'created' | 'updated' }> {
        const pimMasterId = payload.metadata.pimMasterId;

        // 1. PIM Master ID로 기존 Product 조회
        const existingProduct = await this.findProductByPimMasterId(pimMasterId);

        if (!existingProduct) {
            // 2. 없으면 생성
            const product = await this.createProduct(payload);
            return { product, action: 'created' };
        }

        // 3. 있으면 업데이트
        const product = await this.updateProduct(existingProduct.id, payload);
        return { product, action: 'updated' };
    }

    // medusa product 삭제 (PIM Master ID 기반)
    async deleteProduct(pimMasterId: string): Promise<void> {
        try {
            this.logger.warn(`Deleting Medusa product for PIM masterId: ${pimMasterId}`);

            // 1. PIM Master ID로 기존 Product 조회
            const existingProduct = await this.findProductByPimMasterId(pimMasterId);

            if (!existingProduct) {
                this.logger.debug(`No Medusa product to delete for PIM masterId: ${pimMasterId}`);
                return;
            }

            // 2. Medusa Product 삭제
            await this.client.delete(`/products/${existingProduct.id}`);

            this.logger.log(`Deleted Medusa product: ${existingProduct.id} (PIM: ${pimMasterId})`);
        } catch (error) {
            this.logger.error(
                `Failed to delete Medusa product for PIM masterId: ${pimMasterId}`,
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

