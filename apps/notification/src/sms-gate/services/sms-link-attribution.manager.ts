import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { SmsLinkAttributionKind } from '../constants/sms-link-attribution';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

@Injectable()
export class SmsLinkAttributionManager {
  constructor(private readonly repository: SmsGateRepository) {}

  /** 한 번도 안 눌린 코드는 없는 코드와 같게 본다 — 아무 코드나 넣어 연결을 만들지 못하게. */
  async attribute(code: string, userId: string, kind: SmsLinkAttributionKind): Promise<void> {
    const link = await this.repository.findLinkClickState(code);
    if (!link?.clicked) throw new NotFoundError(`링크를 찾을 수 없습니다: ${code}`);
    await this.repository.insertLinkAttribution({ code, userId, kind });
  }
}
