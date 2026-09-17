import type { FastifyRequest } from 'fastify';
import { readTurn } from './multipart';

type Part = Record<string, unknown>;

function fakeRequest(parts: Part[]): FastifyRequest {
  return {
    isMultipart: () => true,
    parts: async function* () {
      for (const part of parts) yield part;
    },
  } as unknown as FastifyRequest;
}

describe('readTurn', () => {
  it('내용과 fileIds 를 순서대로 맞춘다', async () => {
    const turn = await readTurn(
      fakeRequest([
        { type: 'field', fieldname: 'content', value: '이 상품 등록해줘' },
        { type: 'file', filename: 'a.png', mimetype: 'image/png', toBuffer: () => Promise.resolve(Buffer.from('a')) },
        { type: 'field', fieldname: 'fileIds', value: 'att-a' },
      ]),
    );

    expect(turn.content).toBe('이 상품 등록해줘');
    expect(turn.attachments.map((a) => a.id)).toEqual(['att-a']);
  });

  // 한도 초과는 400 이어야 한다. 그대로 올리면 전역 필터가 500 을 내고, 화면은 500 을
  // "발화가 저장됐을 수 있다" 로 읽어 거절당한 첨부를 되돌리지 않는다.
  it('파서의 파일 수 초과는 500 이 아니라 400 으로 바꾼다', async () => {
    const limitError = Object.assign(new Error('reach files limit'), { code: 'FST_FILES_LIMIT', statusCode: 413 });
    const request = {
      isMultipart: () => true,
      parts: async function* () {
        yield { type: 'field', fieldname: 'content', value: '이거 다 올려줘' };
        throw limitError;
      },
    } as unknown as FastifyRequest;

    await expect(readTurn(request)).rejects.toThrow(/첨부는 한 번에 20개까지입니다/);
  });

  // 파서는 한도를 넘은 필드를 던지지 않고 잘라서 준다. 그대로 넘기면 반토막 난
  // 지시를 모델이 온전한 것으로 읽는다.
  it('잘린 필드는 조용히 넘기지 않고 거절한다', async () => {
    await expect(
      readTurn(fakeRequest([{ type: 'field', fieldname: 'content', value: '앞부분만', valueTruncated: true }])),
    ).rejects.toThrow(/너무 깁니다/);
  });
});
