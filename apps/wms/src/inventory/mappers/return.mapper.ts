import { Return, ReturnItem } from 'apps/wms/database/schemas/wms-schema';
import { type ReturnStatusEnum } from 'apps/wms/database/schemas/enum-values';
import { ReturnDto, ReturnItemDto } from '../dto/return/return-response.dto';

export class ReturnItemMapper {
  static toDto(item: ReturnItem): ReturnItemDto {
    return {
      id: item.id,
      returnId: item.returnId,
      skuId: item.skuId,
      requestedQuantity: item.requestedQuantity,
      receivedQuantity: item.receivedQuantity,
      qcPassedQuantity: item.qcPassedQuantity,
      qcFailedQuantity: item.qcFailedQuantity,
      restockedQuantity: item.restockedQuantity,
      disposedQuantity: item.disposedQuantity,
      locationId: item.locationId,
      qcStatus: item.qcStatus as ReturnStatusEnum | null,
      qcReason: item.qcReason,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}

export class ReturnMapper {
  static toDto(returnEntity: Return, returnItems?: ReturnItem[]): ReturnDto {
    return {
      id: returnEntity.id,
      orderId: returnEntity.orderId,
      shipmentId: returnEntity.shipmentId,
      warehouseId: returnEntity.warehouseId,
      status: returnEntity.status,
      returnReason: returnEntity.returnReason,
      qcInspectedAt: returnEntity.qcInspectedAt?.toISOString() ?? null,
      qcInspectedBy: returnEntity.qcInspectedBy,
      qcNotes: returnEntity.qcNotes,
      restockQuantity: returnEntity.restockQuantity ?? 0,
      disposeQuantity: returnEntity.disposeQuantity ?? 0,
      createdAt: returnEntity.createdAt.toISOString(),
      updatedAt: returnEntity.updatedAt.toISOString(),
      items: returnItems?.map((item) => ReturnItemMapper.toDto(item)),
    };
  }
}
