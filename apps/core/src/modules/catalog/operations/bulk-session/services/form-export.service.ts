import { Injectable } from '@nestjs/common';
import { FormExportManager } from './form-export.manager';
import { FormExportBlankBuilder } from './form-export.blank';
import { FormExportAcceptedDto, FormExportListDto, FormExportStatusDto } from '../dto';

/** 포트. 흐름만 표현하고 검증·DB 는 매니저가 든다. */
@Injectable()
export class FormExportService {
  constructor(
    private readonly manager: FormExportManager,
    private readonly blankBuilder: FormExportBlankBuilder,
  ) {}

  request(masterIds: string[], userId: string): Promise<FormExportAcceptedDto> {
    return this.manager.accept(masterIds, userId);
  }

  getStatus(exportId: string, userId: string): Promise<FormExportStatusDto> {
    return this.manager.getStatus(exportId, userId);
  }

  list(userId: string, page: number, limit: number): Promise<FormExportListDto> {
    return this.manager.list(userId, page, limit);
  }

  getDownloadUrl(exportId: string, userId: string): Promise<string> {
    return this.manager.getDownloadUrl(exportId, userId);
  }

  buildBlankWorkbook(): Promise<Buffer> {
    return this.blankBuilder.build();
  }
}
