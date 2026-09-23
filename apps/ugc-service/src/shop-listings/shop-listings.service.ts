import { Injectable } from '@nestjs/common';
import {
  type AdminShopListingDetailResponseDto,
  type AdminShopListingDto,
  type AdminShopListingListQueryDto,
  type AdminShopListingResponseDto,
  type MemberShopListingDto,
  type MyShopListingResponseDto,
  type PublicShopListingResponseDto,
  type ShopListingContactResponseDto,
} from './dto';
import { ShopListingMapper } from './mappers/shop-listing.mapper';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';

@Injectable()
export class ShopListingsService {
  constructor(
    private readonly reader: ShopListingReader,
    private readonly manager: ShopListingManager,
    private readonly moderation: ShopListingModerationManager,
    private readonly views: ShopListingViewManager,
  ) {}

  // 공개
  async listPublic(): Promise<PublicShopListingResponseDto[]> {
    return (await this.reader.listPublic()).map(ShopListingMapper.toPublicDto);
  }
  async getPublic(slug: string): Promise<PublicShopListingResponseDto> {
    return ShopListingMapper.toPublicDto(await this.reader.findPublicBySlug(slug));
  }
  async getContact(slug: string): Promise<ShopListingContactResponseDto> {
    return ShopListingMapper.toContactDto(await this.reader.findContactBySlug(slug));
  }
  recordView(slug: string, visitorIp: string): Promise<void> {
    return this.views.recordView(slug, visitorIp);
  }

  // 회원
  async listMine(userId: string): Promise<MyShopListingResponseDto[]> {
    return (await this.reader.listByAuthor(userId)).map(ShopListingMapper.toMineDto);
  }
  async getMine(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.reader.findOwned(id, userId));
  }
  async createByMember(dto: MemberShopListingDto, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.createByMember(dto, userId));
  }
  async updateByMember(id: string, dto: MemberShopListingDto, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.updateByMember(id, dto, userId));
  }
  async closeByMember(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.closeByMember(id, userId));
  }
  async reopenByMember(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.reopenByMember(id, userId));
  }
  deleteByMember(id: string, userId: string): Promise<void> {
    return this.manager.deleteByMember(id, userId);
  }

  // 관리자
  async listForAdmin(query: AdminShopListingListQueryDto): Promise<AdminShopListingResponseDto[]> {
    return (await this.reader.listForAdmin(query)).map(ShopListingMapper.toAdminDto);
  }
  async getForAdmin(id: string): Promise<AdminShopListingDetailResponseDto> {
    const [listing, moderations] = await Promise.all([this.reader.findForAdmin(id), this.reader.listModerations(id)]);
    return ShopListingMapper.toAdminDetailDto(listing, moderations);
  }
  async createByAdmin(dto: AdminShopListingDto, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.createByAdmin(dto, adminId));
  }
  async updateByAdmin(id: string, dto: AdminShopListingDto, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.updateByAdmin(id, dto, adminId));
  }
  async setDealStatusByAdmin(id: string, action: 'close' | 'reopen', adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.setDealStatusByAdmin(id, action, adminId));
  }
  async approve(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.approve(id, adminId));
  }
  async reject(id: string, reason: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.reject(id, reason, adminId));
  }
  async hide(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.hide(id, adminId));
  }
  async unhide(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.unhide(id, adminId));
  }
  deleteByAdmin(id: string, adminId: string): Promise<void> {
    return this.manager.deleteByAdmin(id, adminId);
  }
}
