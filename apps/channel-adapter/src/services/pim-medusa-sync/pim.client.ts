// apps/channel-adapter/src/services/pim-medusa-sync/pim.client.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type { PimProductSnapshot } from '../../types';

export interface PimCategoryDetail {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    isActive: boolean;
    path?: string;
}

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

            // GET /masters/:masterId (Active 버전 상세 정보 포함)
            const response = await this.client.get(`/masters/${masterId}`);
            const data = response.data;

            if (!data) {
                throw new Error(`No active version found for master ${masterId}`);
            }

            // 옵션 그룹 맵 (ID -> 이름) - variant option mapping용
            const optionGroupMap = new Map<string, string>(
                data.optionGroups?.map((g: any) => [g.id, g.displayName || g.name]) || []
            );

            // 스냅샷 구성 (ProductDetailDto 기반)
            const snapshot: PimProductSnapshot = {
                masterId: data.masterId,
                versionId: data.id,
                version: data.version,
                name: data.name,
                description: data.description || undefined,
                descriptionHtml: data.descriptionHtml || undefined,
                thumbnail: data.thumbnail
                    ? `${this.configService.get('FILE_SERVICE_URL')}/files/${data.thumbnail}`
                    : undefined,
                images: data.images?.map((img: any) =>
                    `${this.configService.get('FILE_SERVICE_URL')}/files/${img.fileId}`
                ) || undefined,
                seoTitle: data.seoTitle || undefined,
                seoDescription: data.seoDescription || undefined,
                seoKeywords: data.seoKeywords || undefined,
                categoryIds: data.categoryIds || undefined,
                brand: data.brand || undefined,
                tags: data.tagValues?.map((tv: any) => tv.name) || undefined,
                productType: data.productType || undefined,
                optionGroups: data.optionGroups?.map((group: any) => ({
                    id: group.id,
                    name: group.displayName || group.name,
                    values: group.values?.map((value: any) => ({
                        id: value.id,
                        name: value.displayName || value.name,
                        colorCode: value.colorCode,
                        imageUrl: value.imageUrl,
                    })),
                })) || [],
                variants: data.variants?.map((variant: any) => ({
                    id: variant.id,
                    variantName: variant.variantName,
                    sku: variant.sku,
                    variantCode: variant.variantCode,
                    isDefault: variant.isDefault || false,
                    status: variant.status || 'active',
                    optionCombination: variant.optionValues?.map((ov: any) => ({
                        name: ov.optionGroupName || optionGroupMap.get(ov.optionGroupId) || 'Unknown',
                        value: ov.displayName || ov.name,
                    })),
                    basePrice: variant.priceSet?.basePrice ?? variant.price,
                    membershipPrice: variant.priceSet?.membershipPrice,
                    tieredPrices: variant.priceSet?.tieredPrices ?? [],
                })) || [],
                status: data.status,
                isWholesaleOnly: data.isWholesaleOnly || false,
                isMembershipOnly: data.isMembershipOnly || false,
                isGiftcard: data.isGiftcard || false,
                discountable: data.discountable !== false,
            };

            this.logger.debug(
                `Built PIM snapshot: ${masterId} with ${snapshot.variants.length} variants`,
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

    // 단일 카테고리 상세 조회 (parentId/이름/슬러그 포함)
    async getCategory(categoryId: string): Promise<PimCategoryDetail> {
        try {
            const response = await this.client.get(`/categories/${categoryId}`);
            const data = response.data;

            if (!data) {
                throw new Error(`Category not found: ${categoryId}`);
            }

            return {
                id: data.id,
                name: data.name,
                slug: data.slug,
                parentId: data.parentId ?? null,
                isActive: data.isActive ?? true,
                path: data.path,
            };
        } catch (error) {
            this.logger.error(
                `Failed to fetch category from PIM: ${categoryId}`,
                error.stack,
            );
            throw new Error(`PIM getCategory failed: ${error.message}`);
        }
    }
}
