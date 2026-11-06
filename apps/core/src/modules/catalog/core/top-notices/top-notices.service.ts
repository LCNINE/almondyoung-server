import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../catalog.types';
import {
  CreateTopNoticeDto,
  TopNoticeListQueryDto,
  TopNoticePublicDto,
  TopNoticeResponseDto,
  UpdateTopNoticeDto,
} from './dto';
import { TopNoticeMapper } from './mappers';
import { TopNoticeManager } from './top-notice.manager';
import { TopNoticeReader } from './top-notice.reader';

@Injectable()
export class TopNoticesService {
  constructor(
    private readonly reader: TopNoticeReader,
    private readonly manager: TopNoticeManager,
  ) {}

  async create(dto: CreateTopNoticeDto, actorId?: string, tx?: DbTransaction): Promise<TopNoticeResponseDto> {
    return TopNoticeMapper.toDto(await this.manager.create(dto, actorId, tx));
  }

  async list(query: TopNoticeListQueryDto, tx?: DbTransaction): Promise<TopNoticeResponseDto[]> {
    return TopNoticeMapper.toDtoArray(await this.reader.findAll(query, tx));
  }

  async listPublic(tx?: DbTransaction): Promise<TopNoticePublicDto[]> {
    return TopNoticeMapper.toPublicDtoArray(await this.reader.findPublic(new Date(), tx));
  }

  async getById(id: string, tx?: DbTransaction): Promise<TopNoticeResponseDto> {
    return TopNoticeMapper.toDto(await this.reader.findById(id, tx));
  }

  async update(
    id: string,
    dto: UpdateTopNoticeDto,
    actorId?: string,
    tx?: DbTransaction,
  ): Promise<TopNoticeResponseDto> {
    return TopNoticeMapper.toDto(await this.manager.update(id, dto, actorId, tx));
  }

  async remove(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.manager.softDelete(id, actorId, tx);
  }
}
