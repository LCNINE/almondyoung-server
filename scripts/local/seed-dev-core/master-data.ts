import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_RACK_LOCATIONS, SEED_SKUS } from './constants';

/** 순수 마스터 데이터라 도메인 서비스를 경유하지 않는다 — 정합성이 걸린 전이가 없다. */
export async function seedMasterData(tx: DbTx): Promise<void> {
  await tx.insert(wmsTables.warehouses).values([
    // supportedPickingStrategies 를 비워두면 picking-strategy.registry.ts 의 resolveForWarehouse 가
    // 409 를 던져 출고 배치를 아예 만들 수 없다 — 시드는 멀쩡히 도는데 출고만 조용히 막힌다.
    // 구분은 라이브 WAREHOUSE_CONSTANTS 와 같다: 국내(판매) 창고만 discrete, 해외(비판매)는 빈 배열.
    // 토탈피킹(aggregate_then_sort)·multi_order 는 의도적으로 끈 채 둔다.
    {
      id: SEED_IDS.warehouseBucheon,
      name: '부천 물류창고',
      type: 'domestic',
      supportedPickingStrategies: ['discrete'],
    },
    { id: SEED_IDS.warehouseChina, name: '중국 물류창고', type: 'overseas', supportedPickingStrategies: [] },
  ]);

  await tx.insert(wmsTables.locations).values([
    {
      id: SEED_IDS.locBucheonReceiving,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: 'RECEIVING_DEFAULT',
      locationType: 'zone',
      displayName: '입고기본존',
      isSystem: true,
      systemRole: 'inbound_default',
    },
    {
      id: SEED_IDS.locBucheonShipping,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: 'SHIPPING_DEFAULT',
      locationType: 'zone',
      displayName: '출고기본존',
    },
    {
      id: SEED_IDS.locBucheonDamage,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: 'DAMAGE_DEFAULT',
      locationType: 'zone',
      displayName: '불량기본존',
    },
    {
      id: SEED_IDS.locBucheonReturn,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: 'RETURN_DEFAULT',
      locationType: 'zone',
      displayName: '반품기본존',
      isSystem: true,
      systemRole: 'return_default',
    },
    {
      id: SEED_IDS.locChinaReceiving,
      warehouseId: SEED_IDS.warehouseChina,
      code: 'RECEIVING_DEFAULT',
      locationType: 'zone',
      displayName: '입고기본존',
      isSystem: true,
      systemRole: 'inbound_default',
    },
    {
      id: SEED_IDS.locChinaShipping,
      warehouseId: SEED_IDS.warehouseChina,
      code: 'SHIPPING_DEFAULT',
      locationType: 'zone',
      displayName: '출고기본존',
    },
    {
      id: SEED_IDS.locChinaDamage,
      warehouseId: SEED_IDS.warehouseChina,
      code: 'DAMAGE_DEFAULT',
      locationType: 'zone',
      displayName: '불량기본존',
    },
    {
      id: SEED_IDS.locChinaReturn,
      warehouseId: SEED_IDS.warehouseChina,
      code: 'RETURN_DEFAULT',
      locationType: 'zone',
      displayName: '반품기본존',
      isSystem: true,
      systemRole: 'return_default',
    },
    ...SEED_RACK_LOCATIONS.map((rack) => ({
      id: rack.id,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: rack.code,
      locationType: 'zone' as const,
      displayName: rack.displayName,
    })),
  ]);

  await tx.insert(wmsTables.settings).values([
    { warehouseId: SEED_IDS.warehouseBucheon, key: 'use_sub_barcode', value: 'true' },
    { warehouseId: SEED_IDS.warehouseBucheon, key: 'use_expiry_separation', value: 'false' },
    { warehouseId: SEED_IDS.warehouseChina, key: 'use_sub_barcode', value: 'true' },
    { warehouseId: SEED_IDS.warehouseChina, key: 'use_expiry_separation', value: 'false' },
  ]);

  await tx.insert(wmsTables.holders).values([
    { id: SEED_IDS.holderPrimary, name: '개발용 화주 A' },
    { id: SEED_IDS.holderSecondary, name: '개발용 화주 B' },
  ]);

  // shipment.plan 이 shippingProfileId 를 요구한다 (Task 9).
  await tx.insert(wmsTables.deliveryProfiles).values({
    id: SEED_IDS.deliveryProfile,
    name: '개발용 배송 프로필',
    sourceType: 'in_house',
    senderSnapshot: { name: '개발용 발송인', phone: '02-0000-0000' },
    originAddressSnapshot: { address: '부천 물류창고' },
    returnAddressSnapshot: { address: '부천 물류창고' },
    carrierAccountRef: 'dev-local',
    supportedFulfillmentModes: ['in_house'],
  });

  await tx.insert(wmsTables.skus).values(
    SEED_SKUS.map((sku) => ({
      id: sku.id,
      holderId: sku.holderId,
      name: sku.name,
      code: sku.code,
      safetyStock: sku.safetyStock,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    })),
  );

  await tx
    .insert(wmsTables.skuBarcodes)
    .values(SEED_SKUS.map((sku) => ({ skuId: sku.id, barcode: sku.barcode, isPrimary: true })));
}
