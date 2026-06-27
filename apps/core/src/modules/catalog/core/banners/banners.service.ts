import { Injectable } from '@nestjs/common';
import { NotFoundError, ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { eq, and, isNull, sql, SQL, or, lte, gt } from 'drizzle-orm';
import {
  DbTransaction,
  BannerGroup,
  NewBannerGroup,
  UpdateBannerGroup,
  Banner,
  NewBanner,
  UpdateBanner,
} from '../../catalog.types';
import {
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
  BannerGroupResponseDto,
  CreateBannerDto,
  UpdateBannerDto,
  BannerResponseDto,
  BannerGroupWithBannersResponseDto,
} from './dto';
import { BannerMapper } from './mappers';

@Injectable()
export class BannersService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async createBannerGroup(dto: CreateBannerGroupDto, tx?: DbTransaction): Promise<BannerGroupResponseDto> {
    return this.db.run(async (tx) => {
      const existingGroup = await tx
        .select()
        .from(pimSchema.bannerGroups)
        .where(eq(pimSchema.bannerGroups.code, dto.code))
        .limit(1);

      if (existingGroup.length > 0) {
        throw new ConflictError(`Banner group with code "${dto.code}" already exists`);
      }

      const newBannerGroup: NewBannerGroup = dto;

      const [createdGroup] = await tx.insert(pimSchema.bannerGroups).values(newBannerGroup).returning();

      return BannerMapper.toGroupDto(createdGroup);
    }, tx);
  }

  async getBannerGroupById(id: string, tx?: DbTransaction): Promise<BannerGroupResponseDto> {
    return this.db.run(async (tx) => {
      const [group] = await tx
        .select()
        .from(pimSchema.bannerGroups)
        .where(and(eq(pimSchema.bannerGroups.id, id), isNull(pimSchema.bannerGroups.deletedAt)))
        .limit(1);

      if (!group) {
        throw new NotFoundError(`Banner group not found: ${id}`);
      }

      return BannerMapper.toGroupDto(group);
    }, tx);
  }

  async getBannerGroupByCode(code: string, tx?: DbTransaction): Promise<BannerGroupWithBannersResponseDto> {
    return this.db.run(async (tx) => {
      const [group] = await tx
        .select()
        .from(pimSchema.bannerGroups)
        .where(and(eq(pimSchema.bannerGroups.code, code), isNull(pimSchema.bannerGroups.deletedAt)))
        .limit(1);

      if (!group) {
        throw new NotFoundError(`Banner group not found: ${code}`);
      }

      const now = new Date();
      const activeBanners = await tx
        .select()
        .from(pimSchema.banners)
        .where(
          and(
            eq(pimSchema.banners.bannerGroupId, group.id),
            isNull(pimSchema.banners.deletedAt),
            eq(pimSchema.banners.isActive, true),
            or(isNull(pimSchema.banners.displayStartAt), lte(pimSchema.banners.displayStartAt, now)),
            or(isNull(pimSchema.banners.displayEndAt), gt(pimSchema.banners.displayEndAt, now)),
          ),
        )
        .orderBy(pimSchema.banners.sortOrder);

      return {
        ...BannerMapper.toGroupDto(group),
        banners: BannerMapper.toDtoArray(activeBanners),
      };
    }, tx);
  }

  async listBannerGroups(category?: string, tx?: DbTransaction): Promise<BannerGroupResponseDto[]> {
    return this.db.run(async (tx) => {
      const conditions: SQL[] = [isNull(pimSchema.bannerGroups.deletedAt)];

      if (category) {
        conditions.push(eq(pimSchema.bannerGroups.category, category));
      }

      const groups = await tx
        .select()
        .from(pimSchema.bannerGroups)
        .where(and(...conditions))
        .orderBy(pimSchema.bannerGroups.sortOrder);

      return BannerMapper.toGroupDtoArray(groups);
    }, tx);
  }

  async updateBannerGroup(id: string, dto: UpdateBannerGroupDto, tx?: DbTransaction): Promise<BannerGroupResponseDto> {
    return this.db.run(async (tx) => {
      const updateData = {
        ...dto,
        updatedAt: new Date(),
      };

      const [updatedGroup] = await tx
        .update(pimSchema.bannerGroups)
        .set(updateData)
        .where(and(eq(pimSchema.bannerGroups.id, id), isNull(pimSchema.bannerGroups.deletedAt)))
        .returning();

      if (!updatedGroup) {
        throw new NotFoundError(`Banner group not found: ${id}`);
      }

      return BannerMapper.toGroupDto(updatedGroup);
    }, tx);
  }

  async deleteBannerGroup(id: string, deletedBy?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const now = new Date();

      await tx
        .update(pimSchema.banners)
        .set({ deletedAt: now, deletedBy, updatedAt: now })
        .where(and(eq(pimSchema.banners.bannerGroupId, id), isNull(pimSchema.banners.deletedAt)));

      const [deletedGroup] = await tx
        .update(pimSchema.bannerGroups)
        .set({ deletedAt: now, deletedBy, updatedAt: now })
        .where(and(eq(pimSchema.bannerGroups.id, id), isNull(pimSchema.bannerGroups.deletedAt)))
        .returning();

      if (!deletedGroup) {
        throw new NotFoundError(`Banner group not found: ${id}`);
      }
    }, tx);
  }

  async createBanner(dto: CreateBannerDto, tx?: DbTransaction): Promise<BannerResponseDto> {
    return this.db.run(async (tx) => {
      const [group] = await tx
        .select()
        .from(pimSchema.bannerGroups)
        .where(and(eq(pimSchema.bannerGroups.id, dto.bannerGroupId), isNull(pimSchema.bannerGroups.deletedAt)))
        .limit(1);

      if (!group) {
        throw new NotFoundError(`Banner group not found: ${dto.bannerGroupId}`);
      }

      const newBanner: NewBanner = {
        ...dto,
        displayStartAt: dto.displayStartAt ? new Date(dto.displayStartAt) : null,
        displayEndAt: dto.displayEndAt ? new Date(dto.displayEndAt) : null,
        linkedProductMasterIds: dto.linkedProductMasterIds || [],
      };

      const [createdBanner] = await tx.insert(pimSchema.banners).values(newBanner).returning();

      return BannerMapper.toDto(createdBanner);
    }, tx);
  }

  async getBannerById(id: string, tx?: DbTransaction): Promise<BannerResponseDto> {
    return this.db.run(async (tx) => {
      const [banner] = await tx
        .select()
        .from(pimSchema.banners)
        .where(and(eq(pimSchema.banners.id, id), isNull(pimSchema.banners.deletedAt)))
        .limit(1);

      if (!banner) {
        throw new NotFoundError(`Banner not found: ${id}`);
      }

      return BannerMapper.toDto(banner);
    }, tx);
  }

  async listBannersByGroupId(
    bannerGroupId: string,
    includeInactive: boolean = false,
    tx?: DbTransaction,
  ): Promise<BannerResponseDto[]> {
    return this.db.run(async (tx) => {
      const conditions: SQL[] = [
        eq(pimSchema.banners.bannerGroupId, bannerGroupId),
        isNull(pimSchema.banners.deletedAt),
      ];

      if (!includeInactive) {
        conditions.push(eq(pimSchema.banners.isActive, true));
      }

      const banners = await tx
        .select()
        .from(pimSchema.banners)
        .where(and(...conditions))
        .orderBy(pimSchema.banners.sortOrder);

      return BannerMapper.toDtoArray(banners);
    }, tx);
  }

  async updateBanner(id: string, dto: UpdateBannerDto, tx?: DbTransaction): Promise<BannerResponseDto> {
    return this.db.run(async (tx) => {
      const updateData = {
        ...dto,
        displayStartAt: dto.displayStartAt ? new Date(dto.displayStartAt) : undefined,
        displayEndAt: dto.displayEndAt ? new Date(dto.displayEndAt) : undefined,
        updatedAt: new Date(),
      };

      const [updatedBanner] = await tx
        .update(pimSchema.banners)
        .set(updateData)
        .where(and(eq(pimSchema.banners.id, id), isNull(pimSchema.banners.deletedAt)))
        .returning();

      if (!updatedBanner) {
        throw new NotFoundError(`Banner not found: ${id}`);
      }

      return BannerMapper.toDto(updatedBanner);
    }, tx);
  }

  async deleteBanner(id: string, deletedBy?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const now = new Date();

      const [deletedBanner] = await tx
        .update(pimSchema.banners)
        .set({ deletedAt: now, deletedBy, updatedAt: now })
        .where(and(eq(pimSchema.banners.id, id), isNull(pimSchema.banners.deletedAt)))
        .returning();

      if (!deletedBanner) {
        throw new NotFoundError(`Banner not found: ${id}`);
      }
    }, tx);
  }
}
