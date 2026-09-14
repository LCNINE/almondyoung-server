import { ProductAiProvider } from './product-ai.provider';

describe('ProductAiProvider', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalModel = process.env.PRODUCT_AI_MODEL;
  const provider = new ProductAiProvider();
  const history = [{ role: 'user' as const, content: '대표카테고리가 뭐야?' }];
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.PRODUCT_AI_MODEL = 'test-model';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.PRODUCT_AI_MODEL;
    else process.env.PRODUCT_AI_MODEL = originalModel;
  });
  it('서버 설정과 저장된 대화만 모델에 전달하고 완료 답변만 반환한다', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '선택한 카테고리 중 대표 하나입니다.' }],
      }),
    );
    await expect(provider.reply(history)).resolves.toContain('대표');
    expect(request.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.messages).toEqual(history);
    expect(body.model).toBe('test-model');
    expect(body.tools).toBeUndefined();
  });
  it.each(['max_tokens', 'refusal', 'tool_use'])('불완전한 종료 %s를 성공 답변으로 저장하지 않는다', async (reason) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(Response.json({ stop_reason: reason, content: [{ type: 'text', text: '일부 답변' }] }));
    await expect(provider.reply(history)).rejects.toThrow('완성되지');
  });
  it('공급자 에러 응답의 내부 내용을 노출하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ error: 'sensitive diagnostic' }, { status: 500 }));
    await expect(provider.reply(history)).rejects.toThrow('잠시 후');
  });
  it('API 키가 없으면 외부 호출 없이 실패한다', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const request = jest.spyOn(global, 'fetch');
    await expect(provider.reply(history)).rejects.toThrow('설정');
    expect(request).not.toHaveBeenCalled();
  });
});
