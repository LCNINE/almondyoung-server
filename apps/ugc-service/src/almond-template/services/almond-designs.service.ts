import { Injectable } from '@nestjs/common';
import {
  type AdminAlmondDesignResponseDto,
  type AlmondDesignCreatedResponseDto,
  type AlmondDesignResponseDto,
  type CreateAlmondDesignDto,
} from '../dto/almond-design.dto';
import { AlmondDesignMapper } from '../mappers/almond-design.mapper';
import { type AlmondPrintFile, type AlmondPrintFormat } from '../types/almond-design.types';
import { AlmondDesignManager } from './almond-design.manager';
import { AlmondDesignPrinter } from './almond-design.printer';
import { AlmondDesignReader } from './almond-design.reader';

@Injectable()
export class AlmondDesignsService {
  constructor(
    private readonly reader: AlmondDesignReader,
    private readonly manager: AlmondDesignManager,
    private readonly printer: AlmondDesignPrinter,
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
  async renderPrintFile(id: string, format: AlmondPrintFormat): Promise<AlmondPrintFile> {
    return this.printer.print(await this.reader.findPrintSource(id), format);
  }
}
