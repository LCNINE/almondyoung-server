import { Injectable } from '@nestjs/common';
import {
  type AlmondSavedDesignDetailResponseDto,
  type AlmondSavedDesignSummaryResponseDto,
  type AlmondSavedDesignThumbnailResponseDto,
  type ListAlmondSavedDesignsQueryDto,
  type UpsertAlmondSavedDesignDto,
} from '../dto/almond-saved-design.dto';
import { AlmondSavedDesignMapper } from '../mappers/almond-saved-design.mapper';
import { AlmondSavedDesignManager } from './almond-saved-design.manager';
import { AlmondSavedDesignReader } from './almond-saved-design.reader';

@Injectable()
export class AlmondSavedDesignsService {
  constructor(
    private readonly reader: AlmondSavedDesignReader,
    private readonly manager: AlmondSavedDesignManager,
  ) {}

  async list(userId: string, query: ListAlmondSavedDesignsQueryDto): Promise<AlmondSavedDesignSummaryResponseDto[]> {
    const [widthMm, heightMm] = query.size ? query.size.split('x').map(Number) : [];
    const rows = await this.reader.listOwned(userId, { productId: query.productId, widthMm, heightMm });
    return rows.map((row) => AlmondSavedDesignMapper.toSummary(row));
  }
  async get(userId: string, id: string): Promise<AlmondSavedDesignDetailResponseDto> {
    return AlmondSavedDesignMapper.toDetail(await this.reader.findOwned(userId, id));
  }
  async getThumbnail(userId: string, id: string): Promise<AlmondSavedDesignThumbnailResponseDto> {
    return { thumbnailSvg: (await this.reader.findOwned(userId, id)).thumbnailSvg };
  }
  async upsert(userId: string, dto: UpsertAlmondSavedDesignDto): Promise<AlmondSavedDesignDetailResponseDto> {
    return AlmondSavedDesignMapper.toDetail(await this.manager.upsert(userId, dto.design, dto.thumbnailSvg, dto.id));
  }
  remove(userId: string, id: string): Promise<void> {
    return this.manager.remove(userId, id);
  }
}
