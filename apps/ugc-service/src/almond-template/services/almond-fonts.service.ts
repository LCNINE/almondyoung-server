import { Injectable } from '@nestjs/common';
import { type AlmondFontResponseDto, type CreateAlmondFontDto } from '../dto/almond-font.dto';
import { AlmondFontMapper } from '../mappers/almond-font.mapper';
import { AlmondFontManager } from './almond-font.manager';
import { AlmondFontReader } from './almond-font.reader';

@Injectable()
export class AlmondFontsService {
  constructor(
    private readonly reader: AlmondFontReader,
    private readonly manager: AlmondFontManager,
  ) {}

  async list(): Promise<AlmondFontResponseDto[]> {
    return (await this.reader.listActive()).map((row) => AlmondFontMapper.toResponse(row));
  }
  async create(dto: CreateAlmondFontDto, userId: string): Promise<AlmondFontResponseDto> {
    return AlmondFontMapper.toResponse(await this.manager.create(dto.fileId, dto.name, userId));
  }
  remove(id: string, userId: string): Promise<void> {
    return this.manager.remove(id, userId);
  }
}
