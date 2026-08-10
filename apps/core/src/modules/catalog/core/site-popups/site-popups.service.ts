import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../catalog.types';
import { CreateSitePopupDto, SitePopupListQueryDto, SitePopupResponseDto, UpdateSitePopupDto } from './dto';
import { SitePopupMapper } from './mappers';
import { SitePopupManager } from './site-popup.manager';
import { SitePopupReader } from './site-popup.reader';
import { SitePopupViewerType } from './site-popup.constants';

@Injectable()
export class SitePopupsService {
  constructor(
    private readonly reader: SitePopupReader,
    private readonly manager: SitePopupManager,
  ) {}

  async create(dto: CreateSitePopupDto, actorId?: string, tx?: DbTransaction): Promise<SitePopupResponseDto> {
    return SitePopupMapper.toDto(await this.manager.create(dto, actorId, tx));
  }

  async list(query: SitePopupListQueryDto, tx?: DbTransaction): Promise<SitePopupResponseDto[]> {
    return SitePopupMapper.toDtoArray(await this.reader.findAll(query, tx));
  }

  async listPublic(viewer: SitePopupViewerType, tx?: DbTransaction): Promise<SitePopupResponseDto[]> {
    return SitePopupMapper.toDtoArray(await this.reader.findPublic(viewer, tx));
  }

  async getById(id: string, tx?: DbTransaction): Promise<SitePopupResponseDto> {
    return SitePopupMapper.toDto(await this.reader.findById(id, tx));
  }

  async update(
    id: string,
    dto: UpdateSitePopupDto,
    actorId?: string,
    tx?: DbTransaction,
  ): Promise<SitePopupResponseDto> {
    return SitePopupMapper.toDto(await this.manager.update(id, dto, actorId, tx));
  }

  async resetDismissals(id: string, actorId?: string, tx?: DbTransaction): Promise<SitePopupResponseDto> {
    return SitePopupMapper.toDto(await this.manager.resetDismissals(id, actorId, tx));
  }

  async remove(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.manager.softDelete(id, actorId, tx);
  }
}
