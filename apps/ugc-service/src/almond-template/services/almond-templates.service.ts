import { Injectable } from '@nestjs/common';
import { type AlmondTemplateStatus } from '../constants/almond-template.constants';
import { AlmondTemplateManager } from './almond-template.manager';
import { AlmondTemplateReader } from './almond-template.reader';
import {
  type AdminAlmondTemplateDetailResponseDto,
  type AdminAlmondTemplateSummaryResponseDto,
  type AlmondTemplateDetailResponseDto,
  type AlmondTemplateSummaryResponseDto,
  type UpsertAlmondTemplateDto,
} from '../dto/almond-template.dto';
import { AlmondTemplateMapper } from '../mappers/almond-template.mapper';

@Injectable()
export class AlmondTemplatesService {
  constructor(
    private readonly reader: AlmondTemplateReader,
    private readonly manager: AlmondTemplateManager,
  ) {}

  async listPublished(): Promise<AlmondTemplateSummaryResponseDto[]> {
    return (await this.reader.listPublished()).map((row) => AlmondTemplateMapper.toSummary(row));
  }
  async getPublished(id: string): Promise<AlmondTemplateDetailResponseDto> {
    return AlmondTemplateMapper.toDetail(await this.reader.findPublished(id));
  }
  getPublishedThumbnail(id: string): Promise<string> {
    return this.reader.findPublishedThumbnail(id);
  }

  async listForAdmin(): Promise<AdminAlmondTemplateSummaryResponseDto[]> {
    return (await this.reader.listAll()).map((row) => AlmondTemplateMapper.toAdminSummary(row));
  }
  async getForAdmin(id: string): Promise<AdminAlmondTemplateDetailResponseDto> {
    return AlmondTemplateMapper.toAdminDetail(await this.reader.findById(id));
  }
  async upsert(dto: UpsertAlmondTemplateDto, userId: string): Promise<AdminAlmondTemplateDetailResponseDto> {
    return AlmondTemplateMapper.toAdminDetail(
      await this.manager.upsert(dto.design, dto.thumbnailSvg, dto.status, userId),
    );
  }
  async updateStatus(id: string, status: AlmondTemplateStatus): Promise<AdminAlmondTemplateSummaryResponseDto> {
    return AlmondTemplateMapper.toAdminSummary(await this.manager.updateStatus(id, status));
  }
  remove(id: string): Promise<void> {
    return this.manager.remove(id);
  }
}
