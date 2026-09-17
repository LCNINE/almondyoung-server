/**
 * 도구가 실행될 때 받는 것. Core/file-service 호출에 필요한 것만 담는다 —
 * 라우트가 만들어 넘기므로 도구 구현은 쿠키·환경변수를 몰라도 된다.
 */
export type SkillContext = {
  /** Core·file-service 에 붙일 인증 헤더 (accessToken/refreshToken 쿠키). */
  coreHeaders: (extra?: Record<string, string>) => Promise<Record<string, string>>;
  coreApiUrl: string;
  fileServiceUrl: string;
  /**
   * 사용자가 Esc 로 요청을 끊으면 abort 된다. 도구 안에서 여러 번 호출할 때
   * (조회 뒤 저장 같은) 취소 이후에 변경 요청이 나가는 것을 막는다.
   */
  signal?: AbortSignal;
  /** 이번 요청에 사용자가 첨부한 파일. 멀티턴으로 넘어가지 않는다 — 다시 첨부해야 한다. */
  attachments: SkillAttachment[];
  /**
   * 올린 파일을 기록한다. 상품에 붙지 못한 파일을 나중에 수거하려면 어시스턴트가
   * 무엇을 올렸는지 알아야 한다. uploadToFileService 가 대신 불러주므로 스킬은
   * 신경 쓸 필요 없다.
   */
  onUpload?: (fileId: string, contextId: string) => Promise<void>;
};

export type SkillAttachment = {
  /**
   * 이 요청 안에서 첨부를 가리키는 고유 키. 패널이 붙여 보낸다 —
   * 파일명으로 식별하면 같은 이름을 두 개 첨부했을 때 성공한 하나 때문에
   * 실패한 다른 하나까지 지워진다.
   */
  id: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

/**
 * 도구 정의는 provider 중립 형태로 둔다 — 라우트가 OpenAI/Anthropic 형식으로 옮긴다.
 * 스킬이 특정 SDK 타입을 물면 모델을 갈 때 스킬 20여 개를 전부 고쳐야 한다.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type SkillTool = {
  definition: ToolDefinition;
  /**
   * 되돌리기 어렵거나 손님에게 바로 보이는 작업인가.
   *
   * true 면 레지스트리가 `confirmed: true` 없이는 실행을 거부한다. 지시문으로만
   * 막으면 모델이 그 문장을 무시하는 순간 상품이 지워진다 — 프롬프트는 규율이지
   * 방어선이 아니다.
   */
  destructive?: boolean;
  /**
   * 반환값은 그대로 tool_result 로 모델에게 간다. 사람이 아니라 모델이 읽으므로
   * 요약하지 말고 판단에 필요한 사실을 담는다.
   */
  execute: (input: unknown, ctx: SkillContext) => Promise<unknown>;
};

export type Skill = {
  name: string;
  /** 사용자에게 보이는 이름 (패널의 기능 목록). */
  label: string;
  /** 모델이 읽는 지시문. 시스템 프롬프트에 그대로 합쳐진다. */
  instructions: string;
  /**
   * 이 스킬을 쓸 수 있는 스코프. 하나라도 가진 요청에만 도구와 지시문이 실린다.
   *
   * 스코프를 나누는 것만으로는 격리가 안 된다 — 도구 목록은 모델에게 통째로 가므로,
   * 여기서 거르지 않으면 고객 토큰으로 들어온 요청 앞에도 delete_product 가 놓인다.
   * 스킬을 더할 때 이 값을 빠뜨리면 아무도 못 쓰게 되지, 아무나 쓰게 되지는 않는다.
   */
  scopes: string[];
  tools: SkillTool[];
};

/** 도구가 실패를 모델에게 알리는 방법. 예외를 던지면 루프가 죽으므로 이걸 반환한다. */
export function toolError(message: string, detail?: unknown) {
  return { ok: false, error: message, detail };
}

/**
 * Core 호출 한 곳. 도메인 에러 메시지(403/409 사유)를 모델이 읽게 그대로 싣는다 —
 * 상태코드만 넘기면 모델이 원인을 못 좁히고 같은 호출을 반복한다.
 */
export async function core(ctx: SkillContext, path: string, init: RequestInit = {}): Promise<unknown> {
  return request(ctx, `${ctx.coreApiUrl}${path}`, init);
}

/** 취소된 뒤의 호출은 보내지 않는다. 도구가 조회 → 저장으로 이어질 때가 특히 위험하다. */
export class RequestAbortedError extends Error {
  constructor() {
    super('요청이 취소되었습니다.');
    this.name = 'AbortError';
  }
}

async function request(ctx: SkillContext, url: string, init: RequestInit): Promise<unknown> {
  if (ctx.signal?.aborted) throw new RequestAbortedError();

  const isJson = init.body !== undefined && !(init.body instanceof FormData);
  const res = await fetch(url, {
    ...init,
    signal: ctx.signal,
    headers: await ctx.coreHeaders(isJson ? { 'Content-Type': 'application/json' } : undefined),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message = (body as { message?: string | string[] })?.message ?? `HTTP ${res.status}`;
    return toolError(Array.isArray(message) ? message.join('\n') : message, {
      status: res.status,
    });
  }
  return body;
}

export type UploadedFile = { id: string; url: string; fileName: string };

/**
 * file-service 업로드. 브라우저는 presign → 스토리지 직접 PUT 을 쓰지만
 * 서버에서는 프록시 경로(multipart)가 단순하고 상한도 충분하다.
 */
export async function uploadToFileService(
  ctx: SkillContext,
  file: SkillAttachment,
  contextId: string,
  isPublic = true,
): Promise<UploadedFile | ReturnType<typeof toolError>> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
  form.append('contextId', contextId);
  form.append('isPublic', String(isPublic));

  const result = await request(ctx, `${ctx.fileServiceUrl}/files/upload`, {
    method: 'POST',
    body: form,
  });

  if ((result as { ok?: boolean })?.ok === false) return result as never;

  const uploaded = result as UploadedFile;
  // 기록 실패로 업로드를 되돌리지 않는다. 수거를 못 하는 것보다 파일을 잃는 쪽이 나쁘다.
  await ctx.onUpload?.(uploaded.id, contextId).catch(() => undefined);
  return uploaded;
}

/** 파일명 비교는 화면과 같은 규칙이다 — 경로를 떼고 대소문자·앞뒤 공백을 무시한다. */
export function normalizeFileName(name: string): string {
  return name.split(/[\\/]/).pop()!.trim().toLowerCase();
}
