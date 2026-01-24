// apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.ts
import { Logger } from '@nestjs/common';
import type { PimProductSnapshot, MedusaProductPayload } from '../../../types';

const logger = new Logger('PimToMedusaTransformer');

export interface MedusaSyncOverrides {
    categories?: Array<{ id: string }>;
    tags?: Array<{ value: string; id?: string }>;
    type_id?: string;
    sales_channels?: string[];
}

// PIM Product Snapshot을 Medusa Upsert Payload로 변환
export function transformPimToMedusa(
    snapshot: PimProductSnapshot,
    overrides?: MedusaSyncOverrides,
): MedusaProductPayload {
    logger.log(`Transforming PIM snapshot: ${snapshot.masterId} v${snapshot.version}`);
    const toFileUrl = (fileId?: string | null): string | undefined => {
        if (!fileId) return undefined;
        if (/^https?:\/\//i.test(fileId)) return fileId;
        const base = process.env.FILE_SERVICE_URL;
        if (!base) return fileId;
        return `${base.replace(/\/$/, '')}/files/${fileId}`;
    };

    // 1. 기본 정보
    const title = snapshot.name || '제목 없음';
    const handle = `${snapshot.masterId}`;
    const status = mapPimStatusToMedusaStatus(snapshot.status);

    const description = undefined;

    // 2. 이미지
    // PIM의 sortOrder에 따라 정렬 - 배열 순서가 Medusa의 rank가 됨
    const images =
        snapshot.images
            ?.slice() // 원본 배열 복사
            .sort((a, b) => {
                // isPrimary가 true인 것을 먼저
                if (a.isPrimary && !b.isPrimary) return -1;
                if (!a.isPrimary && b.isPrimary) return 1;
                // 그 다음 sortOrder로 정렬
                return a.sortOrder - b.sortOrder;
            })
            .map((img) => ({
                url: img.url,
            })) || [];

    // 3. 옵션 스키마/제목 목록 산출
    const { options, optionTitles } = buildOptionSchema(snapshot.optionGroups || [], snapshot.variants || []);

    // 4. Variants 변환
    const variants = transformVariants(
        snapshot.variants,
        optionTitles,
    );

    // 5. 메타데이터
    const metadata = {
        pimMasterId: snapshot.masterId,
        pimVersionId: snapshot.versionId,
        pimVersion: snapshot.version,
        brand: snapshot.brand,
        seoTitle: snapshot.seoTitle,
        seoDescription: snapshot.seoDescription,
        seoKeywords: snapshot.seoKeywords,
        isWholesaleOnly: snapshot.isWholesaleOnly,
        isMembershipOnly: snapshot.isMembershipOnly,
        productType: snapshot.productType,
        syncedAt: new Date().toISOString(),
    };

    // 6. 분류
    const categories =
        overrides?.categories ??
        snapshot.categoryIds?.map((id) => ({ id }));
    const tags =
        overrides?.tags ??
        snapshot.tags?.map((value) => ({ value }));
    const salesChannels = overrides?.sales_channels?.map((id) => ({ id }));

    return {
        title,
        handle,
        status,
        description,
        thumbnail: toFileUrl(snapshot.thumbnail),
        images,
        options,
        variants,
        categories,
        tags,
        sales_channels: salesChannels,
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

// 옵션 스키마 구성: 옵션 제목 목록 + 각 옵션의 값 목록. Variants에 사용된 값도 포함시키며, 부족할 경우 'Default'를 포함시켜 변환 시 옵션 개수 불일치 오류를 방지.
function buildOptionSchema(
    optionGroups: PimProductSnapshot['optionGroups'],
    variants: PimProductSnapshot['variants'],
): { options: Array<{ title: string; values: string[] }>; optionTitles: string[] } {
    const optionSets = new Map<string, Set<string>>();

    // 1) PIM 옵션 그룹 기반으로 초기화
    if (optionGroups && optionGroups.length > 0) {
        optionGroups.forEach((group) => {
            const set = optionSets.get(group.name) || new Set<string>();
            group.values.forEach((v) => set.add(v.name));
            optionSets.set(group.name, set);
        });
    }

    // 2) Variants의 optionCombination에 등장하는 제목/값 반영
    if (variants) {
        variants.forEach((variant) => {
            variant.optionCombination?.forEach((opt) => {
                const set = optionSets.get(opt.name) || new Set<string>();
                set.add(opt.value);
                optionSets.set(opt.name, set);
            });
        });
    }

    // 3) 어떤 옵션도 없을 때 기본 옵션 추가
    if (optionSets.size === 0) {
        optionSets.set('Default', new Set<string>(['Default']));
    }

    // 4) 변환 시 누락 방지를 위해 모든 옵션에 'Default' 값 보강
    optionSets.forEach((set) => set.add('Default'));

    const optionTitles = Array.from(optionSets.keys());
    const options = optionTitles.map((title) => ({
        title,
        values: Array.from(optionSets.get(title) || []).sort(),
    }));

    return { options, optionTitles };
}

// PIM Variants를 Medusa Variants로 변환
function transformVariants(
    pimVariants: PimProductSnapshot['variants'],
    optionTitles: string[],
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
            // 옵션 조합 매핑 (부족한 옵션은 Default로 채워서 Medusa 옵션 개수 불일치 오류 방지)
            const rawOptions = variant.optionCombination?.reduce(
                (acc, opt) => {
                    acc[opt.name] = opt.value;
                    return acc;
                },
                {} as Record<string, string>,
            ) || {};
            const options: Record<string, string> = {};
            optionTitles.forEach((title) => {
                options[title] = rawOptions[title] || 'Default';
            });

            // Variant 제목: 기본 variant면 "기본", 아니면 옵션 조합
            const title = variant.isDefault
                ? '기본'
                : variant.variantName ||
                Object.values(options).join(' / ') ||
                `Variant ${variant.id.slice(0, 8)}`;

            // 가격 배열 구성 (기본 가격만 포함)
            const prices: Array<{
                amount: number;
                currency_code: string;
            }> = [];

            // 1. 일반 가격 (basePrice)
            if (variant.basePrice !== undefined && variant.basePrice !== null) {
                prices.push({
                    amount: Math.round(variant.basePrice),
                    currency_code: 'krw',
                });
            }

            const stripBarcode = process.env.STRIP_BARCODE_ON_SYNC === 'true';

            return {
                title: variant.variantName || '기본 품목',
                sku: variant.sku || undefined,
                barcode: stripBarcode ? undefined : variant.variantCode || undefined,
                manage_inventory: false,

                weight: variant.weight,
                length: variant.length,
                width: variant.width,
                height: variant.height,
                origin_country: variant.originCountry,
                mid_code: variant.midCode,
                hs_code: variant.hsCode,
                material: variant.material,

                options: Object.keys(options).length > 0 ? options : { Default: 'Default' },
                prices: prices.length > 0 ? prices : undefined,
                metadata: {
                    pimVariantId: variant.id,
                    variantCode: variant.variantCode,
                    displayOrder: variant.displayOrder,
                    // Price List 동기화를 위해 원본 가격 정보 보존
                    membershipPrice: variant.membershipPrice,
                    tieredPrices: variant.tieredPrices,
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
