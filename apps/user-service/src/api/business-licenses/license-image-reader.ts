import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoReviewRecord, IsBusinessNumberChecksumConstraint } from './dto/business-license.dto';

// haiku 는 숫자 오독이 잦아 쓰지 않는다 (#930 실측).
export const LICENSE_READER_MODEL = 'claude-sonnet-5';

export type LicenseReading = NonNullable<AutoReviewRecord['reading']>;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isBusinessRegistration',
    'businessNumber',
    'representativeName',
    'startDate',
    'isCorporation',
    'readable',
  ],
  properties: {
    isBusinessRegistration: { type: 'boolean', description: '사업자등록증 또는 사업자등록증명 문서인가' },
    businessNumber: { type: ['string', 'null'], description: '숫자 10자리, 하이픈 없이' },
    representativeName: { type: ['string', 'null'], description: '성명 또는 대표자성명' },
    startDate: { type: ['string', 'null'], description: '개업연월일 YYYYMMDD' },
    isCorporation: { type: 'boolean', description: '법인사업자인가' },
    readable: { type: 'boolean', description: '세 값을 확신을 갖고 읽었는가. 흐리거나 가려져 추측했으면 false' },
  },
};

const PROMPT =
  '이 이미지에서 사업자등록 정보를 읽어라. 개업일은 "개업연월일" 또는 "개업일" 칸이며 발급일·사업자등록일과 혼동하지 말 것. 확신이 없는 값은 null 로 두고 readable=false.';

const CHECKSUM_RETRY =
  '방금 읽은 사업자등록번호는 체크섬이 맞지 않는다. 숫자 하나하나(특히 3/5/6/8/9/0)를 다시 확인해서 읽어라.';

const checksum = new IsBusinessNumberChecksumConstraint();

// 판독만 한다. 진위는 국세청 진위확인이 본다. 체크섬이 틀리면 한 번 다시 읽힌다.
@Injectable()
export class LicenseImageReader {
  private client: Anthropic | null = null;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!this.configService.get<string>('ANTHROPIC_API_KEY');
  }

  async read(imageUrl: string): Promise<LicenseReading> {
    const first: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: PROMPT },
        ],
      },
    ];

    const a = await this.ask(first);
    if (!a.reading.businessNumber || checksum.validate(a.reading.businessNumber)) return a.reading;

    const b = await this.ask([
      ...first,
      { role: 'assistant', content: a.content },
      { role: 'user', content: CHECKSUM_RETRY },
    ]);
    return b.reading;
  }

  private async ask(
    messages: Anthropic.MessageParam[],
  ): Promise<{ reading: LicenseReading; content: Anthropic.ContentBlock[] }> {
    const res = await this.getClient().messages.create({
      model: LICENSE_READER_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages,
    });

    const text = res.content.find((b) => b.type === 'text')?.text;
    if (res.stop_reason !== 'end_turn' || !text) {
      throw new Error(`사업자등록증 판독 응답 이상: stop_reason=${res.stop_reason}`);
    }
    // 구조화 출력이라 스키마 모양이 보장된다.
    return { reading: JSON.parse(text) as LicenseReading, content: res.content };
  }

  private getClient(): Anthropic {
    this.client ??= new Anthropic({ apiKey: this.configService.get<string>('ANTHROPIC_API_KEY') });
    return this.client;
  }
}
