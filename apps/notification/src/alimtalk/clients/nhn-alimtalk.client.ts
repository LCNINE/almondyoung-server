import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { BadRequestError, ServiceUnavailableError, UpstreamUnavailableError } from '@app/shared';
import { isResendSettingMissing } from '../../provider/providers/kakao/nhn-resend-setting';

export type NhnTemplateStatus = 'TSC01' | 'TSC02' | 'TSC03' | 'TSC04';

export interface NhnButton {
  ordering: number;
  type: string;
  name: string;
  linkMo?: string | null;
  linkPc?: string | null;
}

export interface NhnTemplateComment {
  id: number;
  content: string;
  userName: string | null;
  createdAt: string;
  /** INQ 문의 · APR 승인 · REJ 반려 · REP 답변 · REQ 검수 중 */
  status: string;
}

export interface NhnTemplate {
  templateCode: string;
  kakaoTemplateCode: string | null;
  templateName: string;
  templateContent: string;
  templateMessageType: string | null;
  templateEmphasizeType: string | null;
  categoryCode: string | null;
  buttons: NhnButton[];
  comments: NhnTemplateComment[];
  status: NhnTemplateStatus;
  statusName: string;
  createDate: string | null;
  updateDate: string | null;
}

export interface NhnCategory {
  code: string;
  name: string;
  groupName: string;
  inclusion: string | null;
  exclusion: string | null;
}

export interface NhnTemplateInput {
  templateName: string;
  templateContent: string;
  categoryCode: string;
  buttons: { ordering: number; type: 'WL'; name: string; linkMo: string; linkPc?: string }[];
}

export interface NhnBatchRecipient {
  recipientNo: string;
  templateParameter: Record<string, string>;
  /** 응답의 각 결과를 우리 행에 되짚는 키. 알림 행 id 를 쓴다. */
  recipientGroupingKey: string;
}

export interface NhnBatchResult {
  requestId: string;
  results: { recipientGroupingKey: string; resultCode: number; resultMessage: string }[];
}

export interface NhnMessageResult {
  recipientSeq: number;
  recipientNo: string;
  recipientGroupingKey: string | null;
  /** COMPLETED 성공 · FAILED 실패 · CANCEL 취소, 그 밖(비어 있음 등)은 아직 처리 중 */
  messageStatus: string | null;
  resultCode: string | null;
  resultCodeName: string | null;
  /** RSC01 미대상 · RSC02 대상 · RSC03 진행 중 · RSC04 성공 · RSC05 실패 */
  resendStatus: string | null;
  resendStatusName: string | null;
}

interface NhnHeader {
  resultCode: number;
  resultMessage: string;
  isSuccessful: boolean;
}

/** 발송 요청 자체를 NHN 이 받지 않았다 (템플릿 미승인 등). 같은 캠페인의 남은 묶음도 같은 이유로 거절된다. */
export class NhnRequestRejectedError extends Error {}

const READ_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;

/**
 * 관리자 알림톡(템플릿 관리·대량 발송)용 NHN 클라이언트.
 *
 * 이벤트 알림의 발송 프로바이더(NHNProvider)와 인증번호 경로를 건드리지 않으려고 따로 둔다.
 * 키가 없어도 부팅은 되고, 쓰려는 순간 503 이다.
 */
@Injectable()
export class NhnAlimtalkClient {
  private readonly logger = new Logger(NhnAlimtalkClient.name);
  private readonly http: AxiosInstance;
  private readonly appKey: string;
  private readonly senderKey: string;
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    this.appKey = this.configService.get<string>('NHN_APP_KEY') ?? '';
    this.senderKey = this.configService.get<string>('NHN_SENDER_KEY') ?? '';
    const secretKey = this.configService.get<string>('NHN_SECRET_KEY') ?? '';
    this.configured =
      this.configService.get<string>('APP_STAGE') !== 'demo' && !!this.appKey && !!this.senderKey && !!secretKey;
    this.http = axios.create({
      baseURL: this.configService.get<string>('NHN_API_URL') || 'https://api-alimtalk.cloud.toast.com',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-Secret-Key': secretKey },
    });
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async listTemplates(): Promise<NhnTemplate[]> {
    const data = await this.read<{ templateListResponse?: { templates?: RawTemplate[] } }>(
      `${this.templatesPath()}?pageNum=1&pageSize=1000`,
    );
    return (data.templateListResponse?.templates ?? []).map(toTemplate);
  }

  /**
   * 단건 주소 대신 목록에 코드 필터를 건다 — 없는 코드면 빈 목록이 와서 «없음» 과 «조회 실패» 가 갈린다.
   * 목록 응답에도 심사 의견(comments)이 들어 있다. 필터는 부분일치일 수 있어 코드가 같은 것만 고른다.
   */
  async getTemplate(templateCode: string): Promise<NhnTemplate | null> {
    const data = await this.read<{ templateListResponse?: { templates?: RawTemplate[] } }>(
      `${this.templatesPath()}?templateCode=${encodeURIComponent(templateCode)}&pageNum=1&pageSize=1000`,
    );
    const found = (data.templateListResponse?.templates ?? []).find((t) => t.templateCode === templateCode);
    return found ? toTemplate(found) : null;
  }

  async listCategories(): Promise<NhnCategory[]> {
    const data = await this.read<{ categories?: { subCategories?: RawCategory[] }[] }>(
      `/alimtalk/v2.3/appkeys/${this.appKey}/template/categories`,
    );
    return (data.categories ?? []).flatMap((group) =>
      (group.subCategories ?? []).map((c) => ({
        code: c.code,
        name: c.name,
        groupName: c.groupName ?? '',
        inclusion: c.inclusion ?? null,
        exclusion: c.exclusion ?? null,
      })),
    );
  }

  async createTemplate(templateCode: string, input: NhnTemplateInput): Promise<void> {
    await this.write('post', this.templatesPath(), { templateCode, ...this.templateBody(input) });
  }

  async updateTemplate(templateCode: string, input: NhnTemplateInput): Promise<void> {
    await this.write('put', `${this.templatesPath()}/${encodeURIComponent(templateCode)}`, this.templateBody(input));
  }

  async addComment(templateCode: string, comment: string): Promise<void> {
    await this.write('post', `${this.templatesPath()}/${encodeURIComponent(templateCode)}/comments`, { comment });
  }

  /**
   * 한 템플릿으로 최대 1,000명에게 치환 발송한다. 알림톡이 안 닿으면 NHN 이 같은 본문으로 문자를 대신 보낸다
   * (대체 본문을 주지 않으면 NHN 이 본문 + 웹링크로 만든다).
   * NHN 이 요청을 거절하면 NhnRequestRejectedError, 응답을 못 받으면(타임아웃 등) 그 밖의 오류를 던진다 —
   * 후자는 실제로 나갔는지 알 수 없다.
   */
  async sendTemplateBatch(input: {
    templateCode: string;
    senderGroupingKey: string;
    recipients: NhnBatchRecipient[];
  }): Promise<NhnBatchResult> {
    this.assertConfigured();
    const resendSendNo = this.configService.get<string>('NHN_SMS_SEND_NO');
    const send = (withResend: boolean) =>
      this.http.post<{ header: NhnHeader; message?: RawSendMessage }>(
        `/alimtalk/v2.3/appkeys/${this.appKey}/messages`,
        {
          senderKey: this.senderKey,
          templateCode: input.templateCode,
          senderGroupingKey: input.senderGroupingKey,
          recipientList: input.recipients.map((r) => ({
            recipientNo: r.recipientNo,
            templateParameter: r.templateParameter,
            recipientGroupingKey: r.recipientGroupingKey,
            ...(withResend && { resendParameter: { isResend: true, ...(resendSendNo && { resendSendNo }) } }),
          })),
        },
        { timeout: SEND_TIMEOUT_MS },
      );
    let response = await send(true);
    // 발신 프로필에 대체 발송 설정이 빠져 있으면 알림톡까지 통째로 거절된다 — 이때는 한 명도 접수되지 않았으므로
    // 대체 발송만 빼고 다시 보낸다.
    if (!response.data.header?.isSuccessful && isResendSettingMissing(response.data.header?.resultMessage)) {
      this.logger.warn(`발신 프로필에 대체 발송 설정이 없어 알림톡만 다시 보낸다 (templateCode=${input.templateCode})`);
      response = await send(false);
    }
    const { header, message } = response.data;
    if (!header?.isSuccessful || !message?.requestId) {
      throw new NhnRequestRejectedError(header?.resultMessage || 'NHN 이 발송 요청을 거절했습니다');
    }
    return {
      requestId: message.requestId,
      results: (message.sendResults ?? []).map((r) => ({
        recipientGroupingKey: r.recipientGroupingKey ?? '',
        resultCode: r.resultCode,
        resultMessage: r.resultMessage ?? '',
      })),
    };
  }

  /** 한 발송 요청(최대 1,000명)의 수신 결과. NHN 은 90일이 지난 요청을 돌려주지 않는다. */
  async listMessageResults(requestId: string): Promise<NhnMessageResult[]> {
    const data = await this.read<{ messageSearchResultResponse?: { messages?: RawMessageResult[] } }>(
      `/alimtalk/v2.3/appkeys/${this.appKey}/messages?requestId=${encodeURIComponent(requestId)}&pageNum=1&pageSize=1000`,
    );
    return (data.messageSearchResultResponse?.messages ?? []).map((m) => ({
      recipientSeq: m.recipientSeq,
      recipientNo: m.recipientNo ?? '',
      recipientGroupingKey: m.recipientGroupingKey ?? null,
      messageStatus: m.messageStatus ?? null,
      resultCode: m.resultCode ?? null,
      resultCodeName: m.resultCodeName ?? null,
      resendStatus: m.resendStatus ?? null,
      resendStatusName: m.resendStatusName ?? null,
    }));
  }

  private templatesPath(): string {
    return `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates`;
  }

  private templateBody(input: NhnTemplateInput) {
    return {
      templateName: input.templateName,
      templateContent: input.templateContent,
      templateMessageType: 'BA',
      templateEmphasizeType: 'NONE',
      categoryCode: input.categoryCode,
      securityFlag: false,
      buttons: input.buttons,
    };
  }

  private assertConfigured(): void {
    if (!this.configured) throw new ServiceUnavailableError('알림톡(NHN) 설정이 없어 쓸 수 없습니다');
  }

  private async read<T>(path: string): Promise<T> {
    this.assertConfigured();
    const data = await this.call<T & { header: NhnHeader }>(() =>
      this.http.get<T & { header: NhnHeader }>(path, { timeout: READ_TIMEOUT_MS }),
    );
    if (!data.header?.isSuccessful) throw new UpstreamUnavailableError(`NHN 조회 실패: ${data.header?.resultMessage}`);
    return data;
  }

  /** 등록·수정·문의는 NHN 이 입력을 거절하면 그 사유를 그대로 관리자에게 보여 준다. */
  private async write(method: 'post' | 'put', path: string, body: object): Promise<void> {
    this.assertConfigured();
    const data = await this.call<{ header: NhnHeader }>(() =>
      this.http.request<{ header: NhnHeader }>({ method, url: path, data: body, timeout: READ_TIMEOUT_MS }),
    );
    if (!data.header?.isSuccessful) throw new BadRequestError(`카카오 템플릿 요청 거절: ${data.header?.resultMessage}`);
  }

  private async call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await request()).data;
    } catch (error) {
      const detail = isAxiosError(error) ? `${error.response?.status ?? ''} ${error.message}` : String(error);
      this.logger.error(`NHN 알림톡 API 호출 실패: ${detail}`);
      throw new UpstreamUnavailableError('NHN 알림톡 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요');
    }
  }
}

interface RawTemplate {
  templateCode: string;
  kakaoTemplateCode?: string | null;
  templateName: string;
  templateContent?: string | null;
  templateMessageType?: string | null;
  templateEmphasizeType?: string | null;
  categoryCode?: string | null;
  buttons?: NhnButton[] | null;
  comments?: NhnTemplateComment[] | null;
  status: NhnTemplateStatus;
  statusName?: string | null;
  createDate?: string | null;
  updateDate?: string | null;
}

interface RawCategory {
  code: string;
  name: string;
  groupName?: string | null;
  inclusion?: string | null;
  exclusion?: string | null;
}

interface RawSendMessage {
  requestId?: string;
  sendResults?: { recipientGroupingKey?: string | null; resultCode: number; resultMessage?: string | null }[];
}

interface RawMessageResult {
  recipientSeq: number;
  recipientNo?: string | null;
  recipientGroupingKey?: string | null;
  messageStatus?: string | null;
  resultCode?: string | null;
  resultCodeName?: string | null;
  resendStatus?: string | null;
  resendStatusName?: string | null;
}

function toTemplate(raw: RawTemplate): NhnTemplate {
  return {
    templateCode: raw.templateCode,
    kakaoTemplateCode: raw.kakaoTemplateCode ?? null,
    templateName: raw.templateName,
    templateContent: raw.templateContent ?? '',
    templateMessageType: raw.templateMessageType ?? null,
    templateEmphasizeType: raw.templateEmphasizeType ?? null,
    categoryCode: raw.categoryCode ?? null,
    buttons: raw.buttons ?? [],
    comments: raw.comments ?? [],
    status: raw.status,
    statusName: raw.statusName ?? '',
    createDate: raw.createDate ?? null,
    updateDate: raw.updateDate ?? null,
  };
}
