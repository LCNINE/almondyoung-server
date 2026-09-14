import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

import {
  appendProductAiMessageSchema,
  createProductAiSessionSchema,
  productAiListQuerySchema,
  productAiMessagesQuerySchema,
} from './product-ai.schema';

function parseProductAiInput<T>(schema: z.ZodType<T>, input: unknown): T {
  return new ZodValidationPipe(schema).transform(input, { type: 'query' });
}

describe('상품등록 대화 입력 경계', () => {
  const message = { requestId: randomUUID(), expectedRevision: 0, content: '상품등록해줘' };

  it.each(['role', 'ownerId', 'toolResult', 'approval'])('클라이언트의 %s 주입을 거절한다', (key) => {
    expect(() => parseProductAiInput(appendProductAiMessageSchema, { ...message, [key]: 'injected' })).toThrow(
      BadRequestException,
    );
  });

  it.each(['', '   ', 'x'.repeat(20_001)])('빈 메시지와 크기 제한 위반을 거절한다', (content) => {
    expect(() => parseProductAiInput(appendProductAiMessageSchema, { ...message, content })).toThrow(
      BadRequestException,
    );
  });

  it('소유자는 요청 본문에서 받지 않는다', () => {
    expect(() =>
      parseProductAiInput(createProductAiSessionSchema, {
        requestId: randomUUID(),
        ownerId: randomUUID(),
      }),
    ).toThrow(BadRequestException);
  });

  it.each([-1, 0.5, '0', 2_147_483_647])('잘못된 revision %s를 거절한다', (expectedRevision) => {
    expect(() => parseProductAiInput(appendProductAiMessageSchema, { ...message, expectedRevision })).toThrow(
      BadRequestException,
    );
  });

  it('조회 크기와 커서 범위를 제한한다', () => {
    expect(parseProductAiInput(productAiMessagesQuerySchema, { after: '2', limit: '10' })).toEqual({
      after: 2,
      limit: 10,
    });
    for (const query of [{ limit: '101' }, { page: 'Infinity' }, { page: '1junk' }]) {
      expect(() => parseProductAiInput(productAiListQuerySchema, query)).toThrow(BadRequestException);
    }
  });
});
