import type { DeliveryProfile } from '../../schema/inventory.schema';
import type { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import type { DeliveryProfileReturnAddressDto } from '../dto/delivery-profile-address.dto';

type NewColumns = Partial<Omit<DeliveryProfile, 'id' | 'createdAt' | 'updatedAt' | 'handlingFlags'>>;

/**
 * create/update 양쪽에서 오는 입력. avgDeliveryDays 만 `CreateDeliveryProfileDto` 보다 넓다 —
 * PATCH 는 이 필드에 한해 `null`(지우기)을 허용한다(update-delivery-profile.dto.ts 참고).
 */
type ProfileColumnsInput = Partial<Omit<CreateDeliveryProfileDto, 'avgDeliveryDays'>> & {
  avgDeliveryDays?: number | null;
};

/** jsonb 는 옛 모양(`{ address }`)·null 일 수 있다 — 모르는 키는 빈 문자열로. */
function text(source: unknown, key: string): string {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
  // 위에서 object·non-array 로 좁혔다 — drizzle jsonb 컬럼은 타입이 `unknown` 이라 키 접근에
  // 캐스팅이 필요하고, 좁힌 뒤라 키 조회 자체는 안전하다(값 타입만 아래에서 다시 확인한다).
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
  static toColumns(dto: ProfileColumnsInput): NewColumns {
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
