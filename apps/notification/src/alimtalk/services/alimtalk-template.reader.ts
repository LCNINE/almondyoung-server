import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { NhnAlimtalkClient, NhnCategory, NhnTemplate } from '../clients/nhn-alimtalk.client';
import { AlimtalkRepository, LinkedEvent } from '../repositories/alimtalk.repository';
import { extractVariables } from '../utils/template-variables';

export interface AlimtalkTemplateView extends NhnTemplate {
  variables: string[];
  /** 이 템플릿을 쓰는 이벤트 알림. 켜진 것이 있으면 수정하면 그 알림이 재심사 동안 멈춘다. */
  linkedEvents: Omit<LinkedEvent, 'templateCode'>[];
}

/**
 * 템플릿의 정본은 NHN(카카오 심사 상태·반려 사유 포함)이다. 우리 DB 에 사본을 두지 않고 화면을 열 때
 * NHN 목록을 한 번 부른다 — 사본을 두면 심사 결과가 늦게 반영되고, 본문이 갈리면 화면과 실제 발송이 달라진다.
 */
@Injectable()
export class AlimtalkTemplateReader {
  constructor(
    private readonly client: NhnAlimtalkClient,
    private readonly repository: AlimtalkRepository,
  ) {}

  async list(): Promise<AlimtalkTemplateView[]> {
    const templates = await this.client.listTemplates();
    const linked = await this.repository.findLinkedEvents(templates.map((t) => t.templateCode));
    return templates.map((t) => this.toView(t, linked));
  }

  async get(templateCode: string): Promise<AlimtalkTemplateView> {
    const template = await this.client.getTemplate(templateCode);
    if (!template) throw new NotFoundError(`알림톡 템플릿을 찾을 수 없습니다: ${templateCode}`);
    return this.toView(template, await this.repository.findLinkedEvents([templateCode]));
  }

  async exists(templateCode: string): Promise<boolean> {
    return (await this.client.getTemplate(templateCode)) !== null;
  }

  /** 발송은 카카오 승인(TSC03)된 템플릿으로만 된다. 아니면 NHN 이 거절한다. */
  async getApproved(templateCode: string): Promise<AlimtalkTemplateView> {
    const template = await this.get(templateCode);
    if (template.status !== 'TSC03') {
      throw new BadRequestError(
        `카카오 승인이 끝난 템플릿으로만 보낼 수 있습니다 (지금: ${template.statusName || template.status})`,
      );
    }
    return template;
  }

  categories(): Promise<NhnCategory[]> {
    return this.client.listCategories();
  }

  private toView(template: NhnTemplate, linked: LinkedEvent[]): AlimtalkTemplateView {
    return {
      ...template,
      variables: extractVariables(template.templateContent, template.buttons),
      linkedEvents: linked
        .filter((e) => e.templateCode === template.templateCode)
        .map(({ eventKey, name, isActive }) => ({ eventKey, name, isActive })),
    };
  }
}
