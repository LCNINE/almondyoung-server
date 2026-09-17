import { BadRequestError } from '@app/shared';
import type { FastifyRequest } from 'fastify';
import type { SkillAttachment } from '../../skills/types';

export type IncomingTurn = {
  content: string;
  attachments: SkillAttachment[];
};

/**
 * 한 턴의 입력을 스킬이 쓰는 형태로 옮긴다.
 *
 * fileIds 는 files 와 같은 순서로 온다 — 파일명으로 식별하면 같은 이름을 두 개
 * 첨부했을 때 성공한 하나 때문에 실패한 다른 하나까지 소비된 것으로 처리된다.
 */
export async function readTurn(request: FastifyRequest): Promise<IncomingTurn> {
  if (!request.isMultipart()) {
    const body = (request.body ?? {}) as { content?: unknown };
    return { content: typeof body.content === 'string' ? body.content : '', attachments: [] };
  }

  let content = '';
  const fileIds: string[] = [];
  const attachments: SkillAttachment[] = [];

  try {
    await collectParts(request, attachments, fileIds, (value) => {
      content = value;
    });
  } catch (err) {
    // 한도 초과는 400 으로 바꾼다. 그대로 올리면 전역 필터가 500 을 내는데,
    // 화면은 500 을 "저장됐을 수도 있음" 으로 읽어 첨부를 되돌리지 않는다.
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'FST_FILES_LIMIT') {
      throw new BadRequestError(`첨부는 한 번에 ${MAX_FILES_PER_TURN}개까지입니다. 나눠서 보내주세요.`);
    }
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new BadRequestError('파일 하나가 너무 큽니다. 20MB 아래로 줄여주세요.');
    }
    if (code.startsWith('FST_')) {
      throw new BadRequestError('첨부를 읽지 못했습니다. 파일 수와 크기를 줄여 다시 시도해주세요.');
    }
    throw err;
  }

  attachments.forEach((attachment, index) => {
    attachment.id = fileIds[index] || `att-${index}`;
  });

  return { content, attachments };
}

/** main.ts 의 limits.files 와 같은 값. 에러 메시지에도 이 숫자를 쓴다. */
export const MAX_FILES_PER_TURN = 20;

async function collectParts(
  request: FastifyRequest,
  attachments: SkillAttachment[],
  fileIds: string[],
  setContent: (value: string) => void,
): Promise<void> {
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      attachments.push({
        // 실제 키는 아래에서 fileIds 와 맞춘다 — 필드 순서가 보장되지 않아
        // 파일을 다 읽은 뒤에 붙인다.
        id: '',
        fileName: part.filename,
        mimeType: part.mimetype || 'application/octet-stream',
        bytes: await part.toBuffer(),
      });
      continue;
    }

    // 한도를 넘은 필드는 파서가 잘라서 준다. 잘린 지시를 모델이 온전한 것으로
    // 읽으면 안 되므로 여기서 끊는다.
    if (part.valueTruncated) {
      throw new BadRequestError(`${part.fieldname} 가 너무 깁니다. 내용을 나눠서 보내주세요.`);
    }

    // part.value 는 파서가 주는 unknown 이다. 객체가 오면 "[object Object]" 가 되므로
    // 문자열일 때만 받는다 — 그게 아니면 클라이언트가 형식을 어긴 것이다.
    const value = typeof part.value === 'string' ? part.value : '';
    if (part.fieldname === 'content') setContent(value);
    if (part.fieldname === 'fileIds') fileIds.push(value);
  }
}

/**
 * Core·file-service 호출에 실을 인증 헤더를 만든다.
 *
 * 이 앱은 자기 신원이 없다 — 부른 사람의 것을 그대로 전달한다. 서비스 계정을 두면
 * 어드민이 못 보는 것까지 도구가 볼 수 있게 된다.
 */
export function callerAuthHeaders(request: FastifyRequest): Record<string, string> {
  const { cookie, authorization } = request.headers;
  return {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
  };
}
