import { Injectable } from '@nestjs/common';
import {
  type AlmondTemplateCategoryResponseDto,
  type UpsertAlmondTemplateCategoryDto,
} from '../dto/almond-template-category.dto';
import { AlmondTemplateCategoryMapper } from '../mappers/almond-template-category.mapper';
import { type AlmondTemplateCategoryInput } from '../types/almond-template-category.types';
import { AlmondTemplateCategoryManager } from './almond-template-category.manager';
import { AlmondTemplateCategoryReader } from './almond-template-category.reader';

const toInput = (dto: UpsertAlmondTemplateCategoryDto): AlmondTemplateCategoryInput => ({
  name: dto.name.trim(),
  description: dto.description?.trim() || null,
  imageFileId: dto.imageFileId,
  kind: dto.kind,
  isVisible: dto.isVisible ?? true,
});

@Injectable()
export class AlmondTemplateCategoriesService {
  constructor(
    private readonly reader: AlmondTemplateCategoryReader,
    private readonly manager: AlmondTemplateCategoryManager,
  ) {}

  async listVisible(): Promise<AlmondTemplateCategoryResponseDto[]> {
    return (await this.reader.listVisible()).map((row) => AlmondTemplateCategoryMapper.toResponse(row));
  }
  async listForAdmin(): Promise<AlmondTemplateCategoryResponseDto[]> {
    return (await this.reader.listAll()).map((row) => AlmondTemplateCategoryMapper.toResponse(row));
  }
  async create(dto: UpsertAlmondTemplateCategoryDto, userId: string): Promise<AlmondTemplateCategoryResponseDto> {
    return AlmondTemplateCategoryMapper.toResponse(await this.manager.create(toInput(dto), userId));
  }
  async update(
    id: string,
    dto: UpsertAlmondTemplateCategoryDto,
    userId: string,
  ): Promise<AlmondTemplateCategoryResponseDto> {
    return AlmondTemplateCategoryMapper.toResponse(await this.manager.update(id, toInput(dto), userId));
  }
  remove(id: string, userId: string): Promise<void> {
    return this.manager.remove(id, userId);
  }
  reorder(ids: string[], userId: string): Promise<void> {
    return this.manager.reorder(ids, userId);
  }
}
