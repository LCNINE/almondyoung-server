import { Injectable } from '@nestjs/common';
import { NhnCategory } from '../clients/nhn-alimtalk.client';
import { AlimtalkTestSendDto, CreateAlimtalkTemplateDto, UpdateAlimtalkTemplateDto } from '../dto';
import { AlimtalkTemplateManager, AlimtalkTestSendResult } from './alimtalk-template.manager';
import { AlimtalkTemplateReader, AlimtalkTemplateView } from './alimtalk-template.reader';

@Injectable()
export class AlimtalkTemplatesService {
  constructor(
    private readonly reader: AlimtalkTemplateReader,
    private readonly manager: AlimtalkTemplateManager,
  ) {}

  list(): Promise<AlimtalkTemplateView[]> {
    return this.reader.list();
  }

  get(templateCode: string): Promise<AlimtalkTemplateView> {
    return this.reader.get(templateCode);
  }

  categories(): Promise<NhnCategory[]> {
    return this.reader.categories();
  }

  create(dto: CreateAlimtalkTemplateDto): Promise<AlimtalkTemplateView> {
    return this.manager.create(dto);
  }

  update(templateCode: string, dto: UpdateAlimtalkTemplateDto): Promise<AlimtalkTemplateView> {
    return this.manager.update(templateCode, dto);
  }

  comment(templateCode: string, comment: string): Promise<AlimtalkTemplateView> {
    return this.manager.comment(templateCode, comment);
  }

  testSend(templateCode: string, adminUserId: string, dto: AlimtalkTestSendDto): Promise<AlimtalkTestSendResult> {
    return this.manager.testSend(templateCode, adminUserId, dto);
  }
}
