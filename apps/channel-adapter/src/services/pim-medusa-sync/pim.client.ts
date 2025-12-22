// apps/channel-adapter/src/services/pim-medusa-sync/pim.client.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type { PimProductSnapshot } from '../../types';

@Injectable()
export class PimClient {
    private readonly logger = new Logger(PimClient.name);
    private readonly client: AxiosInstance;
    private readonly apiUrl: string;

    constructor(private readonly configService: ConfigService) {
        this.apiUrl =
            this.configService.get<string>('PIM_API_URL') || '';

        this.client = axios.create({
            baseURL: this.apiUrl,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });

        this.logger.log(`PIM client initialized: ${this.apiUrl}`);
    }

    // Master ID의 Active Version 조회
    async getActiveVersion(masterId: string): Promise<PimProductSnapshot> {
        try {
            this.logger.debug(`Fetching PIM active version: ${masterId}`);

            // GET /masters/:masterId/versions/active
            const versionResponse = await this.client.get(
                `/masters/${masterId}/versions/active`,
            );

            const version = versionResponse.data;
            if (!version) {
                throw new Error(`No active version found for master ${masterId}`);
            }

            this.logger.debug(
                `Got PIM version: ${version.id} v${version.version} (${version.name})`,
            );

            // 추가 데이터 조회

            // 1. Variants 조회
            const variantsResponse = await this.client.get(
                `/masters/${masterId}/variants`,
                {
                    params: {
                        versionId: version.id,
                        includePrice: true, // 가격 정보 포함
                    },
                },
            );

            const variants = variantsResponse.data?.data || [];

            // 2. 옵션 그룹 조회
            const optionsResponse = await this.client.get(
                `/masters/${masterId}/options`,
                {
                    params: {
                        versionId: version.id,
                    },
                },
            );

            const optionGroups = optionsResponse.data?.data || [];

            // 스냅샷 구성
            const snapshot: PimProductSnapshot = {
                masterId: version.masterId,
                versionId: version.id,
                version: version.version,
                name: version.name,
                description: version.description || undefined,
                thumbnail: version.thumbnail || undefined,
                images: version.images || undefined,
                categoryIds: version.categoryIds || undefined,
                brand: version.brand || undefined,
                tags: version.tags || undefined,
                optionGroups: optionGroups.map((group: any) => ({
                    id: group.id,
                    name: group.displayName,
                    values: group.values.map((value: any) => ({
                        id: value.id,
                        name: value.displayName,
                        colorCode: value.colorCode,
                        imageUrl: value.imageUrl,
                    })),
                })),
                variants: variants.map((variant: any) => ({
                    id: variant.id,
                    variantName: variant.variantName,
                    sku: variant.sku,
                    isDefault: variant.isDefault || false,
                    status: variant.status || 'active',
                    optionCombination: variant.optionCombination || undefined,
                    basePrice: variant.calculatedPrice?.basePrice, // 가격 정책 계산 결과
                    membershipPrice: variant.calculatedPrice?.membershipPrice,
                })),
                status: version.status,
                isGiftcard: version.isGiftcard || false,
                discountable: version.discountable !== false, // 기본값 true
            };

            this.logger.debug(
                `Built PIM snapshot: ${masterId} with ${variants.length} variants`,
            );

            return snapshot;
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`PIM master not found or no active version: ${masterId}`);
            }

            this.logger.error(
                `Failed to get PIM active version: ${masterId}`,
                error.stack,
            );
            throw new Error(`PIM getActiveVersion failed: ${error.message}`);
        }
    }

    // 모든 Active Masters 목록 조회 (백필용)
    async getAllActiveMasters(): Promise<string[]> {
        try {
            this.logger.log('Fetching all active PIM masters...');

            // GET /masters?mode=active
            const response = await this.client.get('/masters', {
                params: {
                    mode: 'active',
                    page: 1,
                    limit: 1000, // 최대치 todo: 페이징 필요
                },
            });

            const masters = response.data?.data || [];
            const masterIds = masters.map((item: any) => item.product.masterId);

            this.logger.log(`Found ${masterIds.length} active PIM masters`);
            return masterIds;
        } catch (error) {
            this.logger.error('Failed to get all active masters', error.stack);
            throw new Error(`PIM getAllActiveMasters failed: ${error.message}`);
        }
    }

    // 헬스 체크: PIM API 연결 확인
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.client.get('/masters', {
                params: { limit: 1 },
            });
            return response.status === 200;
        } catch (error) {
            this.logger.error('PIM health check failed', error.message);
            return false;
        }
    }
}

