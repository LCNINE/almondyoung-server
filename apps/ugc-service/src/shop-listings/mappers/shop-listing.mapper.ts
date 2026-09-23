import {
  type AdminShopListingDetailResponseDto,
  type AdminShopListingResponseDto,
  type MyShopListingResponseDto,
  type PublicShopListingResponseDto,
  type ShopListingContactResponseDto,
  type ShopListingModerationResponseDto,
} from '../dto';
import { type ShopListingModerationEntity, type ShopListingWithImages } from '../types';

export class ShopListingMapper {
  static toPublicDto(e: ShopListingWithImages): PublicShopListingResponseDto {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      content: e.content,
      region: e.region,
      businessType: e.businessType,
      dealType: e.dealType,
      areaPyeong: e.areaPyeong,
      deposit: e.deposit,
      monthlyRent: e.monthlyRent,
      keyMoney: e.keyMoney,
      thumbnailFileId: e.imageFileIds[0] ?? null,
      imageFileIds: e.imageFileIds,
      status: e.status,
      viewCount: e.viewCount,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  static toMineDto(e: ShopListingWithImages): MyShopListingResponseDto {
    return {
      ...ShopListingMapper.toPublicDto(e),
      rejectReason: e.status === 'rejected' ? e.rejectReason : null,
      contactPhone: e.contactPhone,
      kakaoOpenChatUrl: e.kakaoOpenChatUrl,
      submittedAt: e.submittedAt?.toISOString() ?? null,
    };
  }

  static toAdminDto(e: ShopListingWithImages): AdminShopListingResponseDto {
    return { ...ShopListingMapper.toMineDto(e), authorType: e.authorType, authorUserId: e.authorUserId };
  }

  static toAdminDetailDto(
    e: ShopListingWithImages,
    moderations: ShopListingModerationEntity[],
  ): AdminShopListingDetailResponseDto {
    return { ...ShopListingMapper.toAdminDto(e), moderations: moderations.map(ShopListingMapper.toModerationDto) };
  }

  static toContactDto(e: Pick<ShopListingWithImages, 'contactPhone' | 'kakaoOpenChatUrl'>): ShopListingContactResponseDto {
    return { contactPhone: e.contactPhone, kakaoOpenChatUrl: e.kakaoOpenChatUrl };
  }

  static toModerationDto(m: ShopListingModerationEntity): ShopListingModerationResponseDto {
    return {
      id: m.id,
      decidedBy: m.decidedBy,
      decision: m.decision,
      label: m.label,
      confidence: m.confidence,
      reason: m.reason,
      actorUserId: m.actorUserId,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
