import { Injectable } from '@nestjs/common';
import { AlimtalkAutoSendItem, AlimtalkAutoSendReader, AlimtalkAutoSendResult } from './alimtalk-auto-send.reader';

@Injectable()
export class AlimtalkAutoSendsService {
  constructor(private readonly reader: AlimtalkAutoSendReader) {}

  list(before?: Date): Promise<{ items: AlimtalkAutoSendItem[]; nextBefore: string | null }> {
    return this.reader.list(before);
  }

  result(notificationId: string): Promise<AlimtalkAutoSendResult> {
    return this.reader.result(notificationId);
  }
}
