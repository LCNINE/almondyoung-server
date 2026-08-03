import { Injectable } from '@nestjs/common';
import { FormExportManager } from './form-export.manager';
import { FormExportAcceptedDto, FormExportStatusDto } from '../dto';

/** 포트. 흐름만 표현하고 검증·DB 는 매니저가 든다. */
@Injectable()
export class FormExportService {
  constructor(private readonly manager: FormExportManager) {}

  request(masterIds: string[], userId: string): Promise<FormExportAcceptedDto> {
    return this.manager.accept(masterIds, userId);
  }

  getStatus(exportId: string, userId: string): Promise<FormExportStatusDto> {
    return this.manager.getStatus(exportId, userId);
  }

  getDownloadUrl(exportId: string, userId: string): Promise<string> {
    return this.manager.getDownloadUrl(exportId, userId);
  }
}
