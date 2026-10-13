import { Injectable } from '@nestjs/common';
import {
  type AdminAlmondDesignResponseDto,
  type AlmondDesignCreatedResponseDto,
  type AlmondDesignResponseDto,
  type CreateAlmondDesignDto,
} from '../dto/almond-design.dto';
import { ALMOND_PRINT_DEFAULT_DPI } from '../constants/almond-template.constants';
import { AlmondDesignMapper } from '../mappers/almond-design.mapper';
import { type AlmondPrintFile, type AlmondPrintFormat, type AlmondPrintLink } from '../types/almond-design.types';
import { AlmondDesignManager } from './almond-design.manager';
import { AlmondDesignPrinter } from './almond-design.printer';
import { AlmondDesignReader } from './almond-design.reader';
import { AlmondPrintFileManager } from './almond-print-file.manager';

@Injectable()
export class AlmondDesignsService {
  constructor(
    private readonly reader: AlmondDesignReader,
    private readonly manager: AlmondDesignManager,
    private readonly printer: AlmondDesignPrinter,
    private readonly printFiles: AlmondPrintFileManager,
  ) {}

  async create(dto: CreateAlmondDesignDto, userId: string): Promise<AlmondDesignCreatedResponseDto> {
    return AlmondDesignMapper.toCreated(await this.manager.create(dto, userId));
  }
  async getMine(id: string, userId: string): Promise<AlmondDesignResponseDto> {
    return AlmondDesignMapper.toResponse(await this.reader.findOwned(id, userId));
  }
  async getForAdmin(id: string): Promise<AdminAlmondDesignResponseDto> {
    return AlmondDesignMapper.toAdminResponse(await this.reader.findById(id));
  }
  printLink(id: string, format: AlmondPrintFormat, dpi: number, accessToken: string): Promise<AlmondPrintLink> {
    return this.printFiles.link(id, format, dpi, accessToken);
  }
  async renderPreview(id: string, side: 'front' | 'back'): Promise<Buffer | null> {
    return this.printer.preview(await this.reader.findPrintSource(id), side);
  }
  async renderPrintFile(
    id: string,
    format: AlmondPrintFormat,
    dpi = ALMOND_PRINT_DEFAULT_DPI,
  ): Promise<AlmondPrintFile> {
    return this.printer.print(await this.reader.findPrintSource(id), format, dpi);
  }
}
