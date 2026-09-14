import { ProductAiProvider } from './product-ai.provider';

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
