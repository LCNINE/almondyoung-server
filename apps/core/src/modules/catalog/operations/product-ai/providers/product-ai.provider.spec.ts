import { ProductAiProvider } from './product-ai.provider';
import type { ProductAiDraft } from '@packages/product-ai/draft';

describe('ProductAiProvider (OpenAI)', () => {
  const originalKey = process.env.PRODUCT_AI_OPENAI_API_KEY;
  const originalModel = process.env.PRODUCT_AI_MODEL;
  const provider = new ProductAiProvider();
  const history = [{ role: 'user' as const, content: '대표카테고리가 뭐야?' }];
  const completed = (text: string, status = 'completed') => ({
    status,
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  });
  const stream = (events: object[]) =>
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  beforeEach(() => {
    process.env.PRODUCT_AI_OPENAI_API_KEY = 'test-key';
    process.env.PRODUCT_AI_MODEL = 'test-model';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.PRODUCT_AI_OPENAI_API_KEY;
    else process.env.PRODUCT_AI_OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.PRODUCT_AI_MODEL;
    else process.env.PRODUCT_AI_MODEL = originalModel;
  });
  it('전용 키로 Responses API를 호출하고 대화의 공급자 저장을 끈다', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(completed('대표 하나입니다.')));
    await expect(provider.reply(history)).resolves.toContain('대표');
    expect(request.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(request.mock.calls[0][1]!.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-key' }));
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.input).toEqual(history);
    expect(body.model).toBe('test-model');
    expect(body.store).toBe(false);
    expect(body.tools).toBeUndefined();
  });
  it('이미지가 포함된 사용자 메시지를 Responses 이미지 입력으로 전달한다', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(completed('이미지 확인')));
    await provider.reply([{ ...history[0], imageUrls: [image] }]);
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: history[0].content },
      { type: 'input_image', image_url: image, detail: 'auto' },
    ]);
  });
  it('완성된 미리보기 도구 인수를 검증하고 콜백으로 전달한다', async () => {
    const draft: ProductAiDraft = {
      name: '냥이 스티커',
      description: '고양이 그림 스티커',
      seoTitle: '냥이 스티커',
      seoDescription: '고양이 그림 스티커를 만나보세요.',
      seoKeywords: ['고양이 스티커'],
      tags: ['스티커'],
      thumbnailFileId: null,
      additionalImageFileIds: [],
      sections: [{ kind: 'text', heading: '냥이 스티커', body: '고양이 캐릭터 그림입니다.' }],
      pendingItems: ['가격 확인'],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(
      stream([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ type: 'function_call', name: 'prepare_product_draft', arguments: JSON.stringify(draft) }],
          },
        },
      ]),
    );
    const onDraft = jest.fn();
    const onDelta = jest.fn();
    const answer = await provider.reply(history, { onDraft, onDelta });
    expect(onDraft).toHaveBeenCalledWith(draft);
    expect(onDelta).toHaveBeenCalledWith(answer);
    expect(answer).toContain('상품 정보');
  });
  it('검색 결과를 tool output으로 전달하고 후속 답변을 생성한다', async () => {
    const onLookup = jest.fn().mockResolvedValue([{ id: 'category-id', name: '스티커' }]);
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: 'lookup-1',
              name: 'search_product_references',
              arguments: JSON.stringify({ kind: 'categories', query: '스티커' }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(completed('스티커 카테고리를 찾았어요.')));
    await expect(provider.reply(history, { onDraft: jest.fn(), onLookup })).resolves.toContain('찾았어요');
    expect(onLookup).toHaveBeenCalledWith({ kind: 'categories', query: '스티커' });
    expect(JSON.parse(request.mock.calls[1][1]!.body as string).input.at(-1)).toMatchObject({
      type: 'function_call_output',
      call_id: 'lookup-1',
      output: JSON.stringify([{ id: 'category-id', name: '스티커' }]),
    });
  });
  it('완료되지 않은 도구 호출은 미리보기로 저장하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        status: 'incomplete',
        output: [{ type: 'function_call', name: 'prepare_product_draft', arguments: '{}' }],
      }),
    );
    const onDraft = jest.fn();
    await expect(provider.reply(history, { onDraft })).rejects.toThrow();
    expect(onDraft).not.toHaveBeenCalled();
  });
  it.each(['incomplete', 'failed', 'in_progress'])('불완전한 응답 %s를 저장하지 않는다', async (status) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(completed('일부', status)));
    await expect(provider.reply(history)).rejects.toThrow('완성되지');
  });
  it.each([
    [401, '키'],
    [403, '권한'],
    [404, '모델'],
    [429, '한도'],
    [500, '잠시 후'],
  ])('오류 %s를 안전한 메시지로 반환한다', async (status, message) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(Response.json({ error: 'sensitive diagnostic' }, { status: Number(status) }));
    await expect(provider.reply(history)).rejects.toThrow(String(message));
  });
  it('전용 키가 없으면 검색 서비스 키로 대체하지 않고 외부 호출 없이 실패한다', async () => {
    delete process.env.PRODUCT_AI_OPENAI_API_KEY;
    const request = jest.spyOn(global, 'fetch');
    await expect(provider.reply(history)).rejects.toThrow('설정');
    expect(request).not.toHaveBeenCalled();
  });
  it('텍스트 델타를 전달하고 완료 이벤트를 확인한다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      stream([
        { type: 'response.output_text.delta', delta: '안녕' },
        { type: 'response.output_text.delta', delta: '하세요' },
        { type: 'response.completed', response: completed('안녕하세요') },
      ]),
    );
    const onDelta = jest.fn();
    await expect(provider.reply(history, { onDelta })).resolves.toBe('안녕하세요');
    expect(onDelta.mock.calls).toEqual([['안녕'], ['하세요']]);
  });
  it.each(['response.incomplete', 'response.failed', 'error', 'response.output_text.done'])(
    '완료 없는 스트림 %s는 저장하지 않는다',
    async (type) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(stream([{ type: 'response.output_text.delta', delta: '일부' }, { type }]));
      await expect(provider.reply(history, { onDelta: jest.fn() })).rejects.toThrow('완성되지');
    },
  );
  it('Esc 중지 신호가 공급자 요청에도 전달된다', async () => {
    const abort = new AbortController();
    const request = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      abort.abort();
      options!.signal!.throwIfAborted();
      return Response.json(completed('도달하지 않음'));
    });
    await expect(provider.reply(history, { signal: abort.signal })).rejects.toThrow();
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
