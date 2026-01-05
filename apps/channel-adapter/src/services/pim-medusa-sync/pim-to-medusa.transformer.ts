// apps/channel-adapter/src/services/pim-medusa-sync/pim-to-medusa.transformer.ts
import { Logger } from '@nestjs/common';
import type { PimProductSnapshot, MedusaProductPayload } from '../../types';

const logger = new Logger('PimToMedusaTransformer');

export interface MedusaSyncOverrides {
    categories?: Array<{ id: string }>;
    tags?: Array<{ value: string; id?: string }>;
}

// PIM Product Snapshot을 Medusa Upsert Payload로 변환
export function transformPimToMedusa(
    snapshot: PimProductSnapshot,
    overrides?: MedusaSyncOverrides,
): MedusaProductPayload {
    logger.log(`Transforming PIM snapshot: ${snapshot.masterId} v${snapshot.version}`);

    // 1. 기본 정보
    const title = snapshot.name || '제목 없음';
    const handle = `pim-${snapshot.masterId}`;
    const status = mapPimStatusToMedusaStatus(snapshot.status);

    // 2. 이미지
    const images = snapshot.images?.map((url, index) => ({
        url,
        rank: index + 1,
    })) || [];

    // 3. 옵션 변환
    const options = transformOptions(snapshot.optionGroups || []);

    // 4. Variants 변환
    const variants = transformVariants(
        snapshot.variants,
        snapshot.optionGroups || [],
    );

    // 5. 메타데이터
    const metadata = {
        pimMasterId: snapshot.masterId,
        pimVersionId: snapshot.versionId,
        pimVersion: snapshot.version,
        brand: snapshot.brand,
        syncedAt: new Date().toISOString(),
    };

    // 6. 분류
    const categories =
        overrides?.categories ??
        snapshot.categoryIds?.map((id) => ({ id }));
    const tags =
        overrides?.tags ??
        snapshot.tags?.map((value) => ({ value }));

    return {
        title,
        handle,
        status,
        description: snapshot.description,
        thumbnail: snapshot.thumbnail,
        images,
        options,
        variants,
        categories,
        tags,
        metadata,
        is_giftcard: snapshot.isGiftcard,
        discountable: snapshot.discountable,
    };
}

// PIM 상태를 Medusa 상태로 매핑
function mapPimStatusToMedusaStatus(
    pimStatus: string,
): 'draft' | 'published' | 'proposed' | 'rejected' {
    switch (pimStatus) {
        case 'active':
            return 'published';
        case 'draft':
            return 'draft';
        case 'inactive':
            return 'draft';
        default:
            logger.warn(`Unknown PIM status: ${pimStatus}, defaulting to 'draft'`);
            return 'draft';
    }
}

// PIM 옵션 그룹을 Medusa 옵션으로 변환
function transformOptions(
    optionGroups: PimProductSnapshot['optionGroups'],
): Array<{ title: string; values: string[] }> {
    if (!optionGroups || optionGroups.length === 0) {
        // Medusa requires at least one option
        return [{ title: 'Default', values: ['Default'] }];
    }

    return optionGroups.map((group) => ({
        title: group.name,
        values: group.values.map((v) => v.name),
    }));
}

// PIM Variants를 Medusa Variants로 변환
function transformVariants(
    pimVariants: PimProductSnapshot['variants'],
    optionGroups: PimProductSnapshot['optionGroups'],
): MedusaProductPayload['variants'] {
    const MEMBERSHIP_GROUP_ID = process.env.MEDUSA_MEMBERSHIP_GROUP_ID || '';
    const SKIP_VARIANTS_WITHOUT_PRICE = process.env.SKIP_VARIANTS_WITHOUT_PRICE === 'true';

    if (!pimVariants || pimVariants.length === 0) {
        logger.warn('No variants found in PIM snapshot');
        return [];
    }

    return pimVariants
        .filter((v) => v.status !== 'deleted')
        .filter((v) => {
            // 가격 검증: basePrice 없으면 스킵 (옵션)
            if (SKIP_VARIANTS_WITHOUT_PRICE && !v.basePrice) {
                logger.warn(`Skipping variant ${v.id} - no basePrice`);
                return false;
            }
            return true;
        })
        .map((variant) => {
            // 옵션 조합 매핑
            const options = variant.optionCombination?.reduce(
                (acc, opt) => {
                    acc[opt.name] = opt.value;
                    return acc;
                },
                {} as Record<string, string>,
            ) || {};

            // Variant 제목: 기본 variant면 "기본", 아니면 옵션 조합
            const title = variant.isDefault
                ? '기본'
                : variant.variantName ||
                Object.values(options).join(' / ') ||
                `Variant ${variant.id.slice(0, 8)}`;

            // 가격 배열 구성
            const prices: Array<{
                amount: number;
                currency_code: string;
                min_quantity?: number;
                max_quantity?: number;
                rules?: Record<string, string>;
            }> = [];

            // 1. 일반 가격 (basePrice)
            if (variant.basePrice !== undefined && variant.basePrice !== null) {
                prices.push({
                    amount: Math.round(variant.basePrice),
                    currency_code: 'KRW',
                });
            }

            // 2. 멤버십 가격 (customer_group rule)
            if (variant.membershipPrice !== undefined && variant.membershipPrice !== null && MEMBERSHIP_GROUP_ID) {
                prices.push({
                    amount: Math.round(variant.membershipPrice),
                    currency_code: 'KRW',
                    rules: { customer_group_id: MEMBERSHIP_GROUP_ID },
                });
            }

            // 3. Tier 가격 (min_quantity 기반)
            if (variant.tieredPrices && variant.tieredPrices.length > 0) {
                for (const tier of variant.tieredPrices) {
                    prices.push({
                        amount: Math.round(tier.price),
                        currency_code: 'KRW',
                        min_quantity: tier.minQuantity,
                        // max_quantity는 다음 tier의 minQuantity - 1로 계산 가능 (선택)
                    });
                }
            }

            return {
                title,
                sku: variant.sku || undefined,
                // WMS 재고 동기화 완성 전까지 false (품절 처리 방지)
                manage_inventory: false,
                options: Object.keys(options).length > 0 ? options : { Default: 'Default' },
                prices: prices.length > 0 ? prices : undefined,
                metadata: {
                    pimVariantId: variant.id,
                },
            };
        });
}

// 최소 검증: 필수 필드 체크
export function validatePimSnapshot(snapshot: PimProductSnapshot): void {
    if (!snapshot.masterId) {
        throw new Error('PIM snapshot missing masterId');
    }
    if (!snapshot.versionId) {
        throw new Error('PIM snapshot missing versionId');
    }
    if (!snapshot.name) {
        throw new Error('PIM snapshot missing name');
    }
    if (!snapshot.variants || snapshot.variants.length === 0) {
        throw new Error('PIM snapshot must have at least one variant');
    }

    // 가격 검증: 최소 하나의 variant에 가격이 있어야 함
    const SKIP_VARIANTS_WITHOUT_PRICE = process.env.SKIP_VARIANTS_WITHOUT_PRICE === 'true';
    if (SKIP_VARIANTS_WITHOUT_PRICE) {
        const validVariants = snapshot.variants.filter(
            (v) => v.status !== 'deleted' && v.basePrice !== undefined && v.basePrice !== null
        );
        if (validVariants.length === 0) {
            throw new Error('PIM snapshot has no variants with valid prices');
        }
    }
}
