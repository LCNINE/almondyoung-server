import type { DeliveryProfile } from '../../schema/inventory.schema';
import type { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import type { DeliveryProfileReturnAddressDto } from '../dto/delivery-profile-address.dto';

type NewColumns = Partial<Omit<DeliveryProfile, 'id' | 'createdAt' | 'updatedAt' | 'handlingFlags'>>;

/** jsonb 는 옛 모양(`{ address }`)·null 일 수 있다 — 모르는 키는 빈 문자열로. */
function text(source: unknown, key: string): string {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export class DeliveryProfileMapper {
  static toDto(row: DeliveryProfile, skuCount?: number): DeliveryProfileDto {
    const returnPhone = text(row.returnAddressSnapshot, 'phone');
    return {
      id: row.id,
      name: row.name,
      sourceType: row.sourceType,
      avgDeliveryDays: row.avgDeliveryDays,
      sender: { name: text(row.senderSnapshot, 'name'), phone: text(row.senderSnapshot, 'phone') },
      originAddress: {
        postalCode: text(row.originAddressSnapshot, 'postalCode'),
        roadAddress: text(row.originAddressSnapshot, 'roadAddress'),
        detailAddress: text(row.originAddressSnapshot, 'detailAddress'),
      },
      returnAddress: {
        postalCode: text(row.returnAddressSnapshot, 'postalCode'),
        roadAddress: text(row.returnAddressSnapshot, 'roadAddress'),
        detailAddress: text(row.returnAddressSnapshot, 'detailAddress'),
        ...(returnPhone ? { phone: returnPhone } : {}),
      },
      carrierAccountRef: row.carrierAccountRef,
      supportedFulfillmentModes: row.supportedFulfillmentModes ?? [],
      ...(skuCount !== undefined ? { skuCount } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 보낸 필드만 컬럼으로 옮긴다 — PATCH 가 안 보낸 필드를 null 로 덮지 않게. */
  static toColumns(dto: Partial<CreateDeliveryProfileDto>): NewColumns {
    const columns: NewColumns = {};
    if (dto.name !== undefined) columns.name = dto.name.trim();
    if (dto.sourceType !== undefined) columns.sourceType = dto.sourceType;
    if (dto.avgDeliveryDays !== undefined) columns.avgDeliveryDays = dto.avgDeliveryDays;
    if (dto.sender !== undefined) columns.senderSnapshot = { name: dto.sender.name, phone: dto.sender.phone };
    if (dto.originAddress !== undefined) {
      const { postalCode, roadAddress, detailAddress } = dto.originAddress;
      columns.originAddressSnapshot = { postalCode, roadAddress, detailAddress };
    }
    if (dto.returnAddress !== undefined) columns.returnAddressSnapshot = returnSnapshot(dto.returnAddress);
    if (dto.carrierAccountRef !== undefined) columns.carrierAccountRef = dto.carrierAccountRef.trim();
    if (dto.supportedFulfillmentModes !== undefined) columns.supportedFulfillmentModes = dto.supportedFulfillmentModes;
    return columns;
  }
}

function returnSnapshot(address: DeliveryProfileReturnAddressDto): Record<string, string> {
  const { postalCode, roadAddress, detailAddress, phone } = address;
  return { postalCode, roadAddress, detailAddress, ...(phone?.trim() ? { phone } : {}) };
}
