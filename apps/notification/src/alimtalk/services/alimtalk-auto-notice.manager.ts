import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { KAKAO_AUTO_NOTICES, findKakaoAutoNotice } from '../../dispatcher/handlers/kakao-auto-notices';
import { AlimtalkRepository } from '../repositories/alimtalk.repository';
import { AlimtalkTemplateReader } from './alimtalk-template.reader';

export interface AlimtalkAutoNoticeView {
  eventKey: string;
  name: string;
  condition: string;
  /** 이 알림이 채우는 변수 — 이을 템플릿은 이 안의 변수만 써야 한다 */
  variables: string[];
  /** 발송 설정 행이 있는가. 없으면 연결할 때 꺼진 채로 만든다 */
  configured: boolean;
  isActive: boolean;
  templateCode: string | null;
}

/**
 * 알림톡 자동 알림 ↔ 승인된 템플릿 연결. 켜고 끄는 것은 기존 이벤트 설정이 한다 — 여기서는 «무엇으로 보낼지»만 정한다.
 *
 * 막는 것:
 *  - 코드가 보내지 않는 알림에 잇기(목록 밖) — 이어도 발송이 일어나지 않는다
 *  - 승인 전 템플릿 — 카카오가 발송을 거절한다
 *  - 알림이 채우지 않는 변수를 쓰는 템플릿 — 빈 변수가 있으면 카카오가 발송을 거절한다
 *  - 켜진 알림의 템플릿을 확인 없이 바꾸기 — 바로 다음 발송부터 문구가 바뀐다
 */
@Injectable()
export class AlimtalkAutoNoticeManager {
  constructor(
    private readonly repository: AlimtalkRepository,
    private readonly templateReader: AlimtalkTemplateReader,
  ) {}

  async list(): Promise<AlimtalkAutoNoticeView[]> {
    const settings = await this.repository.findAutoNoticeSettings(KAKAO_AUTO_NOTICES.map((n) => n.eventKey));
    return KAKAO_AUTO_NOTICES.map((notice) => {
      const setting = settings.find((s) => s.eventKey === notice.eventKey);
      return {
        eventKey: notice.eventKey,
        name: notice.name,
        condition: notice.condition,
        variables: [...notice.variables],
        configured: !!setting,
        isActive: setting?.isActive ?? false,
        templateCode: setting?.kakaoTemplateCode ?? null,
      };
    });
  }

  async link(eventKey: string, templateCode: string, replaceActive = false): Promise<AlimtalkAutoNoticeView> {
    const notice = findKakaoAutoNotice(eventKey);
    if (!notice) throw new NotFoundError(`알림톡으로 보내는 자동 알림이 아닙니다: ${eventKey}`);

    const template = await this.templateReader.getApproved(templateCode);
    const unknown = template.variables.filter((v) => !notice.variables.includes(v));
    if (unknown.length > 0) {
      throw new BadRequestError(
        `이 알림이 채우지 않는 변수를 템플릿이 씁니다: ${unknown.map((v) => `#{${v}}`).join(', ')}. ` +
          `쓸 수 있는 변수: ${notice.variables.map((v) => `#{${v}}`).join(', ')}`,
      );
    }

    const current = (await this.list()).find((n) => n.eventKey === eventKey);
    if (current?.templateCode === templateCode) return current;
    if (current?.isActive && current.templateCode && !replaceActive) {
      throw new ConflictError(
        `켜져 있는 알림입니다. 템플릿을 바꾸면 다음 발송부터 «${template.templateName}»으로 나갑니다 — 확인하고 다시 요청하세요`,
      );
    }

    await this.repository.linkAutoNotice({
      eventKey,
      name: notice.name,
      description: notice.condition,
      variables: notice.variables,
      templateCode,
      templateName: template.templateName,
      templateBody: template.templateContent,
    });
    return (await this.list()).find((n) => n.eventKey === eventKey) as AlimtalkAutoNoticeView;
  }

  async unlink(eventKey: string): Promise<AlimtalkAutoNoticeView> {
    if (!findKakaoAutoNotice(eventKey)) throw new NotFoundError(`알림톡으로 보내는 자동 알림이 아닙니다: ${eventKey}`);
    const [setting] = await this.repository.findAutoNoticeSettings([eventKey]);
    if (!setting) throw new NotFoundError(`발송 설정이 없는 알림입니다: ${eventKey}`);
    if (setting.isActive) throw new ConflictError('켜져 있는 알림입니다. 먼저 끄세요');
    await this.repository.unlinkAutoNotice(setting.templateKey);
    return (await this.list()).find((n) => n.eventKey === eventKey) as AlimtalkAutoNoticeView;
  }
}
