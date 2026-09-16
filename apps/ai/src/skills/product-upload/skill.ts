import { AI_SCOPE } from '../../platform/auth/ai-scopes';
import type { Skill, SkillTool } from '../types';
import { core, toolError, uploadToFileService, normalizeFileName } from '../types';

function str(input: unknown, key: string): string | null {
  const v = (input as Record<string, unknown>)?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const uploadForm: SkillTool = {
  definition: {
    name: 'upload_product_form',
    description:
      '사용자가 이번 메시지에 첨부한 엑셀 양식(.xlsx)을 일괄 등록/수정 세션으로 업로드한다. 첨부가 없으면 실패한다. 파싱·검증은 서버 워커가 이어받으므로 접수 직후에는 아직 결과가 없다 — get_bulk_session 으로 진행을 확인한다.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '세션 이름(선택). 사용자가 말한 이름이 있을 때만 넣는다.',
        },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const file = ctx.attachments.find((a) => a.fileName.toLowerCase().endsWith('.xlsx'));
    if (!file) {
      return toolError('이번 메시지에 .xlsx 첨부가 없다. 사용자에게 양식 파일을 첨부해 달라고 요청한다.');
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
    const name = str(input, 'name');
    if (name) form.append('name', name);

    const result = await core(ctx, '/product-bulk-sessions', { method: 'POST', body: form });
    if ((result as { ok?: boolean })?.ok === false) return result;
    return { ...(result as object), consumedIds: [file.id] };
  },
};

const listSessions: SkillTool = {
  definition: {
    name: 'list_bulk_sessions',
    description:
      '내가 만든 일괄 등록/수정 세션 목록을 최신순으로 본다. 사용자가 세션 ID 를 말하지 않고 "아까 올린 것" 처럼 말할 때 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '기본 20' },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const limit = (input as { limit?: number })?.limit ?? 20;
    return core(ctx, `/product-bulk-sessions?page=1&limit=${limit}`);
  },
};

const getSession: SkillTool = {
  definition: {
    name: 'get_bulk_session',
    description:
      '세션의 현재 단계와 단계별 집계를 본다. 행 목록은 들어 있지 않다. 업로드·승인·발행 직후처럼 서버 작업이 진행 중일 때 이것으로 확인한다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}`);
  },
};

const listItems: SkillTool = {
  definition: {
    name: 'list_bulk_session_items',
    description:
      '세션의 행 목록을 본다. 오류 행을 볼 때는 status="error", 미결정 충돌이 남은 행은 conflict="undecided" 로 거른다. 승인이 막혔을 때 원인을 찾는 주된 수단이다.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        status: {
          type: 'string',
          description: '행 상태 필터. 오류만 보려면 "error".',
        },
        conflict: {
          type: 'string',
          enum: ['any', 'undecided'],
          description: 'any=충돌 있는 행, undecided=미결정 충돌이 남은 행',
        },
        publishStatus: {
          type: 'string',
          description: '발행 레인 상태 필터. 아이템 status 와 축이 다르다.',
        },
        limit: { type: 'number', description: '기본 20' },
      },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');

    const q = new URLSearchParams({ page: '1' });
    q.set('limit', String((input as { limit?: number })?.limit ?? 20));
    for (const key of ['status', 'conflict', 'publishStatus'] as const) {
      const v = str(input, key);
      if (v) q.set(key, v);
    }
    return core(ctx, `/product-bulk-sessions/${id}/items?${q}`);
  },
};

const decideConflict: SkillTool = {
  definition: {
    name: 'decide_bulk_conflict',
    description:
      '충돌한 필드에 결정을 단다. overwrite=내 양식 값으로 덮어쓴다(남의 편집을 되돌린다), skip=이번엔 그 필드를 건드리지 않는다. 부분 갱신이라 기존 결정에 머지된다. 어느 쪽을 고를지는 사용자가 정한다 — 임의로 결정하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string' },
        decisions: {
          type: 'object',
          description: '필드명 → "overwrite" | "skip" 의 맵',
          additionalProperties: { type: 'string', enum: ['overwrite', 'skip'] },
        },
      },
      required: ['sessionId', 'itemId', 'decisions'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    const itemId = str(input, 'itemId');
    const decisions = (input as { decisions?: unknown })?.decisions;
    if (!id || !itemId || !decisions) {
      return toolError('sessionId, itemId, decisions 가 모두 필요하다');
    }
    return core(ctx, `/product-bulk-sessions/${id}/items/${itemId}/conflict-decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decisions }),
    });
  },
};

const approve: SkillTool = {
  destructive: true,
  definition: {
    name: 'approve_bulk_session',
    description:
      '검토를 승인한다. 오류 행은 제외하고 정상 행만 진행된다 — 오류 행을 살리려면 양식을 고쳐 새 세션으로 올려야 한다. 미결정 충돌이 하나라도 남으면 409 로 막힌다. 사용자가 명시적으로 승인을 요청했을 때만 부른다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}/approve`, { method: 'POST' });
  },
};

const publish: SkillTool = {
  destructive: true,
  definition: {
    name: 'publish_bulk_session',
    description:
      '일괄 발행을 접수한다. 이 시점에 비로소 쇼핑몰에 반영된다. 이미 published 인 세션에서 부르면 실패한 행만 다시 발행한다. 사용자가 명시적으로 발행을 요청했을 때만 부른다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}/publish`, { method: 'POST' });
  },
};

const listImages: SkillTool = {
  definition: {
    name: 'list_bulk_session_images',
    description:
      '세션이 요구하는 이미지 파일 목록과 업로드 진행 상태를 본다. 어떤 파일명을 올려야 하는지 사용자에게 알려줄 때 쓴다. 올리는 것은 upload_session_images 가 한다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}/images`);
  },
};

const uploadImages: SkillTool = {
  definition: {
    name: 'upload_session_images',
    description:
      '이번 메시지에 첨부한 이미지들을 세션이 요구하는 파일명과 맞춰 업로드하고 등록까지 마친다. 요구 목록 조회 → file-service 업로드 → 세션에 통보를 한 번에 처리한다. 파일명은 경로를 떼고 대소문자·앞뒤 공백을 무시하고 비교한다. 요구된 파일이 전부 채워져야 세션이 다음 단계로 간다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    if (ctx.attachments.length === 0) {
      return toolError('이번 메시지에 첨부 파일이 없다. 사용자에게 이미지 파일을 첨부해 달라고 요청한다.');
    }

    type Required = {
      imageKey: string;
      usage: 'main' | 'description';
      contextId: string;
      sourceValue: string;
    };

    // 요구 목록은 전부 읽어야 한다. 한 페이지만 보면 그 뒤의 파일이 첨부돼 있어도
    // 매칭에서 빠져 ignoredAttachments 로 흘러가고, stillMissing 은 비어 있어
    // 「다 올라갔다」로 오독된다.
    const required: Required[] = [];
    const PAGE = 200;
    for (let page = 1; ; page += 1) {
      const listed = await core(
        ctx,
        `/product-bulk-sessions/${id}/images?status=awaiting_upload&onlyRequired=true&page=${page}&limit=${PAGE}`,
      );
      if ((listed as { ok?: boolean })?.ok === false) return listed;

      const body = listed as { data?: Required[]; total?: number };
      const rows = (body.data ?? []).filter(Boolean);
      required.push(...rows);

      const total = body.total ?? required.length;
      if (rows.length === 0 || required.length >= total) break;
    }
    if (required.length === 0) {
      return { ok: true, message: '올려야 할 이미지가 없다.', uploaded: 0 };
    }

    const byName = new Map(ctx.attachments.map((a) => [normalizeFileName(a.fileName), a]));
    const consumedIds = new Set<string>();
    // 한 첨부가 대표·상세 양쪽 요구에 걸릴 수 있다. 그중 하나라도 실패하면 그 첨부는
    // 재시도해야 하므로 소비 처리에서 뺀다.
    const failedIds = new Set<string>();
    const resolutions: { imageKey: string; usage: string; fileId: string }[] = [];
    const failed: { fileName: string; error: string }[] = [];
    const missing: string[] = [];
    const usedNames = new Set<string>();

    for (const item of required) {
      const key = normalizeFileName(item.sourceValue);
      const file = byName.get(key);
      if (!file) {
        missing.push(item.sourceValue);
        continue;
      }
      usedNames.add(key);

      const uploaded = await uploadToFileService(ctx, file, item.contextId);
      if ((uploaded as { ok?: boolean })?.ok === false) {
        failed.push({
          fileName: item.sourceValue,
          error: String((uploaded as { error?: string }).error ?? '업로드 실패'),
        });
        failedIds.add(file.id);
        continue;
      }
      resolutions.push({
        imageKey: item.imageKey,
        usage: item.usage,
        fileId: (uploaded as { id: string }).id,
      });
      consumedIds.add(file.id);
    }

    let resolved: unknown = null;
    if (resolutions.length > 0) {
      // 세션 통보는 한 요청 50건까지다.
      const results: unknown[] = [];
      for (let i = 0; i < resolutions.length; i += 50) {
        const chunk = resolutions.slice(i, i + 50);
        const r = await core(ctx, `/product-bulk-sessions/${id}/images/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolutions: chunk }),
        });
        if ((r as { ok?: boolean })?.ok === false) return r;
        results.push(r);
      }
      resolved = results;
    }

    return {
      ok: true,
      uploaded: resolutions.length,
      resolved,
      failed,
      stillMissing: missing,
      ignoredAttachments: ctx.attachments.map((a) => a.fileName).filter((n) => !usedNames.has(normalizeFileName(n))),
      // 패널이 이 첨부들만 지운다. 실패·미사용 파일은 남겨야 재시도된다.
      consumedIds: [...consumedIds].filter((id) => !failedIds.has(id)),
    };
  },
};

const retryDraft: SkillTool = {
  destructive: true,
  definition: {
    name: 'retry_bulk_draft',
    description:
      'draft 생성에 실패한 행을 재시도한다. 신규 상품 행은 재시도할 때마다 내부 등록 기록이 한 번 더 쌓이므로, 원인을 확인하기 전에 반복 호출하지 않는다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}/retry-draft`, { method: 'POST' });
  },
};

const cancel: SkillTool = {
  destructive: true,
  definition: {
    name: 'cancel_bulk_session',
    description:
      '세션을 취소한다. **되돌릴 수 없고 재개할 수 없다.** 사용자에게 그 점을 말하고 확인을 받은 뒤에만 부른다.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'sessionId');
    if (!id) return toolError('sessionId 가 필요하다');
    return core(ctx, `/product-bulk-sessions/${id}/cancel`, { method: 'POST' });
  },
};

export const productUploadSkill: Skill = {
  name: 'product-upload',
  scopes: [AI_SCOPE.ASSISTANT],
  label: '상품 일괄 등록/수정',
  tools: [
    uploadForm,
    listSessions,
    getSession,
    listItems,
    decideConflict,
    approve,
    publish,
    listImages,
    uploadImages,
    retryDraft,
    cancel,
  ],
  instructions: `엑셀 양식으로 상품을 일괄 등록·수정하는 일을 처리한다.

### 전체 흐름

양식 받기 → 양식 작성 → **업로드 → 검토·승인 → 이미지 올리기 → 일괄 발행**.
굵은 부분이 당신이 도구로 할 수 있는 구간이다.

세션 단계는 이 순서로 넘어간다:
\`접수됨(received) → 검증 중(validating) → 검토 대기(review) → 이미지 대기(awaiting_images) → 임시 버전 생성 중(drafting) → 검토 가능(drafted) → 발행 중(publishing) → 발행 완료(published)\`

### 당신이 할 수 없는 일

- **양식 파일을 받아오거나 셀을 편집하는 것.** 사용자가 작성된 .xlsx 를 첨부해야 시작한다.
- **이미지 파일 업로드.** 어떤 파일명이 필요한지는 \`list_bulk_session_images\` 로 알려줄 수 있지만, 올리는 것은 사용자가 「일괄 등록/수정」 화면에서 해야 한다.
- 빈 양식·프리필 양식 다운로드. 사용자에게 화면 경로를 안내한다 — 신규만이면 \`/mall/bulk-sessions\` 「양식 생성」 탭의 「빈 양식 다운로드」, 기존 상품 수정이면 \`/mall/products-list\` 에서 대상을 체크하고 「양식 다운로드」.

### 반드시 지킬 것

1. **첨부는 그 메시지에서만 유효하다.** 이전 턴에 첨부한 파일은 남아 있지 않다. 다시 업로드가 필요하면 파일을 다시 첨부해 달라고 말한다.
2. **승인·발행·취소·행 제외는 사용자가 명시적으로 요청했을 때만 부른다.** 흐름상 다음 단계라는 이유로 알아서 진행하지 않는다.
3. **취소와 행 제외는 되돌릴 수 없다.** 부르기 전에 그 사실을 말하고 확인을 받는다.
4. **충돌 결정은 사용자가 정한다.** 어느 쪽이 무엇을 뜻하는지(overwrite=내 값으로 덮어씀, skip=남의 값 유지) 설명하고 고르게 한다. 판단을 도와줄 수는 있지만 임의로 결정하지 않는다.
5. 업로드·승인·발행 직후에는 서버 워커가 일하는 중이라 결과가 아직 없다. 한 번 \`get_bulk_session\` 으로 확인하고, 아직 진행 중이면 그 사실을 사용자에게 말한다. **폴링하듯 같은 도구를 연달아 반복 호출하지 않는다.**

### 이미지

- 요구 파일명은 \`list_bulk_session_images\` 로 먼저 보여주고, 사용자가 그 이름의 파일들을 첨부하면 \`upload_session_images\` 로 한 번에 올린다.
- 파일명이 맞아야 붙는다. 안 맞은 첨부는 \`ignoredAttachments\`, 아직 안 온 요구는 \`stillMissing\` 으로 돌아오니 그대로 사용자에게 알린다.
- **요구된 파일이 전부 채워져야** 세션이 다음 단계로 간다. 하나라도 빠지면 거기서 멈추고, 나가는 길은 세션 취소뿐이다.

### 자주 걸리는 것

- **승인이 409 로 막힌다** → 미결정 충돌이 남았다. \`list_bulk_session_items\` 에 \`conflict="undecided"\` 로 걸러 어느 행·어느 필드인지 보여주고 결정을 받는다.
- **오류 행이 있다** → 승인해도 그 행은 진행되지 않는다. \`status="error"\` 로 걸러 행번호·상품키·상품명·사유를 보여준다. 고치려면 양식을 수정해 **새 세션으로** 올려야 한다고 안내한다. 옛 세션은 취소로 정리한다.
- **"양식이 만료되었습니다"** → 그 양식은 더 못 쓴다. 양식 받기부터 다시 해야 한다.
- **10MB 초과** → 업로드되지 않는다.
- **양식의 상품 수가 고른 개수보다 적다** → 판매 중인 버전이 없는 상품은 양식에서 조용히 빠진다. 빠진 상품을 신규 행으로 다시 적으면 중복 상품이 생기므로, 어느 상품이 빠졌는지 대조하라고 안내한다.
- **권한** → 이 기능은 admin 또는 master 권한이 필요하다. 403 이 나면 양식 문제가 아니라 계정 권한 문제다.`,
};
