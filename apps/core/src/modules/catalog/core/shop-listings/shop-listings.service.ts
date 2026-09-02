import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../catalog.types';
import { CreateShopListingDto, ShopListingListQueryDto, ShopListingResponseDto, UpdateShopListingDto } from './dto';
import { ShopListingMapper } from './mappers';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';

@Injectable()
export class ShopListingsService {
  constructor(
    private readonly reader: ShopListingReader,
    private readonly manager: ShopListingManager,
  ) {}

  async create(dto: CreateShopListingDto, actorId?: string, tx?: DbTransaction): Promise<ShopListingResponseDto> {
    return ShopListingMapper.toDto(await this.manager.create(dto, actorId, tx));
  }

  async list(query: ShopListingListQueryDto, tx?: DbTransaction): Promise<ShopListingResponseDto[]> {
    return ShopListingMapper.toDtoArray(await this.reader.findAll(query, tx));
  }

  async listPublic(tx?: DbTransaction): Promise<ShopListingResponseDto[]> {
    return ShopListingMapper.toDtoArray(await this.reader.findPublic(tx));
  }

  async getById(id: string, tx?: DbTransaction): Promise<ShopListingResponseDto> {
    return ShopListingMapper.toDto(await this.reader.findById(id, tx));
  }

  async getPublicBySlug(slug: string, tx?: DbTransaction): Promise<ShopListingResponseDto> {
    return ShopListingMapper.toDto(await this.reader.findPublicBySlug(slug, tx));
  }

  async update(
    id: string,
    dto: UpdateShopListingDto,
    actorId?: string,
    tx?: DbTransaction,
  ): Promise<ShopListingResponseDto> {
    return ShopListingMapper.toDto(await this.manager.update(id, dto, actorId, tx));
  }

  async recordView(slug: string, visitorIp: string, tx?: DbTransaction): Promise<void> {
    return this.manager.incrementViewCount(slug, visitorIp, tx);
  }

  async delete(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.manager.softDelete(id, actorId, tx);
  }
}
