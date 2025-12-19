// apps/channel-adapter/src/services/pim-medusa-sync/pim-to-medusa.transformer.ts
import { Logger } from '@nestjs/common';
import type { PimProductSnapshot, MedusaProductPayload } from '../../types';

const logger = new Logger('PimToMedusaTransformer');

// PIM Product Snapshot을 Medusa Upsert Payload로 변환
export function transformPimToMedusa(
    snapshot: PimProductSnapshot,
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
        syncedAt: new Date().toISOString(),
    };

    // 6. 분류
    const categories = snapshot.categoryIds?.map((id) => ({ id }));
    const tags = snapshot.tags?.map((value) => ({ value }));

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
        return [];
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
    if (!pimVariants || pimVariants.length === 0) {
        logger.warn('No variants found in PIM snapshot');
        return [];
    }

    return pimVariants
        .filter((v) => v.status !== 'deleted')
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

            // 가격 변환 (KRW 기준)
            const prices: Array<{
                amount: number;
                currency_code: string;
                rules?: Record<string, string>;
            }> = [];

            if (variant.basePrice !== undefined && variant.basePrice !== null) {
                prices.push({
                    amount: Math.round(variant.basePrice),
                    currency_code: 'KRW',
                });
            }

            // 멤버십 가격 (customer_group_id 기반 규칙)
            if (variant.membershipPrice !== undefined && variant.membershipPrice !== null) {
                prices.push({
                    amount: Math.round(variant.membershipPrice),
                    currency_code: 'KRW',
                    // TODO: 실제 customer_group_id로 교체 필요
                    // rules: { customer_group_id: 'cgroup_membership_xxx' },
                });
            }

            return {
                title,
                sku: variant.sku || undefined,
                // WMS 재고 동기화 완성 전까지 false (품절 처리 방지)
                manage_inventory: false,
                options: Object.keys(options).length > 0 ? options : undefined,
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
}