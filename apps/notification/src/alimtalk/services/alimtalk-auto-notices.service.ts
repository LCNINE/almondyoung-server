import { Injectable } from '@nestjs/common';
import { AlimtalkAutoNoticeManager, AlimtalkAutoNoticeView } from './alimtalk-auto-notice.manager';

@Injectable()
export class AlimtalkAutoNoticesService {
  constructor(private readonly manager: AlimtalkAutoNoticeManager) {}

  list(): Promise<AlimtalkAutoNoticeView[]> {
    return this.manager.list();
  }

  link(eventKey: string, templateCode: string, replaceActive?: boolean): Promise<AlimtalkAutoNoticeView> {
    return this.manager.link(eventKey, templateCode, replaceActive);
  }

  unlink(eventKey: string): Promise<AlimtalkAutoNoticeView> {
    return this.manager.unlink(eventKey);
  }
}
