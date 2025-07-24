// apps/wms/src/inventory/handlers/pim-event.hadler.ts
import { Injectable, Logger } from '@nestjs/common';
import { ProductMatchingService } from '../services/product-matching.service';

export interface PimProductDetailChangeEvent {
    eventType: 'INVENTORY_MANAGEMENT_CHANGED' | 'VARIANT_ADDED' | 'VARIANT_DELETED';
    productId: string;
    name: string;
    variants: Array<{
        id: string;
        name: string;
        inventoryManagement: boolean;
        components: Array<{
            skuName: string;
        }>;
    }>;
    changedVariantIds?: string[]; // VARIANT_ADDED/DELETED 이벤트용
    previousInventoryManagement?: boolean; // INVENTORY_MANAGEMENT_CHANGED 이벤트용
}

@Injectable()
export class PimEventHandler {
    private readonly logger = new Logger(PimEventHandler.name);

    constructor(
        private readonly productMatchingService: ProductMatchingService,
    ) { }

    // 실제 운영에서는 메시지 큐나 이벤트 버스를 통해 구독
    // 현재는 테스트를 위한 직접 호출 메서드로 구현
    async handlePimProductDetailChange(event: PimProductDetailChangeEvent) {
        this.logger.log(`Handling PIM product detail change event: ${event.eventType}`);

        switch (event.eventType) {
            case 'INVENTORY_MANAGEMENT_CHANGED':
            case 'VARIANT_ADDED':
                // 매칭 대기 상태 생성
                await this.productMatchingService.handleManualMatchingRequest({
                    productId: event.productId,
                    name: event.name,
                    variants: event.variants.filter(v =>
                        event.changedVariantIds ? event.changedVariantIds.includes(v.id) : true
                    ),
                });
                break;

            case 'VARIANT_DELETED':
                // Variant 삭제 처리
                if (event.changedVariantIds) {
                    for (const variantId of event.changedVariantIds) {
                        await this.productMatchingService.handleVariantDeletion(variantId);
                    }
                }
                break;
        }
    }

    // 테스트용 메서드들
    async testAutoMatching(payload: any) {
        this.logger.log('테스트: 자동 매칭 이벤트 처리');
        await this.productMatchingService.handleAutomaticMatchingRequest(payload);
    }

    async testManualMatching(payload: any) {
        this.logger.log('테스트: 수동 매칭 이벤트 처리');
        await this.productMatchingService.handleManualMatchingRequest(payload);
    }

    async testProductDetailChange(event: PimProductDetailChangeEvent) {
        this.logger.log('테스트: 상품 상세정보 변경 이벤트 처리');
        await this.handlePimProductDetailChange(event);
    }
}