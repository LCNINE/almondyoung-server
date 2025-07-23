import { warehouseTypeEnum } from '../../../database/schemas/wms-schema';

export const WAREHOUSE_CONSTANTS = {
    // 기본 창고들
    DEFAULT_DOMESTIC_WAREHOUSE: {
        id: '00000000-0000-0000-0000-000000000001',
        name: '국내 메인 창고',
        location: '부천시',
        type: 'domestic' as const,
    },
    DEFAULT_OVERSEAS_WAREHOUSE: {
        id: '00000000-0000-0000-0000-000000000002',
        name: '해외 메인 창고',
        location: '중국',
        type: 'overseas' as const,
    },
} as const;

export type WarehouseType = typeof warehouseTypeEnum.enumValues[number];