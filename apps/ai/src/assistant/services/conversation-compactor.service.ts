import { Injectable, Logger } from '@nestjs/common';
import { AssistantChatRepository, type MessageRow } from '../repositories/assistant-chat.repository';
import { estimateTokens } from '../lib/conversation-size';
import { restoreConversation, type Message } from '../lib/conversation';
import { getOpenAiClient } from '../lib/openai';
import { positiveNumberEnv } from '../../platform/env';

/**
 * 이 크기를 넘으면 접는다. 대화는 매 턴 통째로 다시 실리므로, 접지 않으면 입력 토큰이
 * 턴 수에 비례해 늘고 비용도 같이 는다.
 */
const thresholdTokens = () => positiveNumberEnv('ASSISTANT_COMPACT_THRESHOLD_TOKENS', 12_000);

/**
 * 원문으로 남길 최근 메시지 수. 방금 한 말과 그 결과는 요약으로 뭉개면 안 된다 —
 * 직전 턴에 올린 이미지의 fileId 나 방금 만든 상품의 id 를 다음 턴이 곧바로 쓴다.
 */
const keepRecent = () => positiveNumberEnv('ASSISTANT_COMPACT_KEEP_RECENT', 6);

/**
 * 요약에 쓰는 모델. 옮겨적기에 가까운 작업이라 본 모델보다 싼 것으로 충분하다 —
 * 요약이 비싸면 접어서 아낀 것을 도로 쓴다.
 */
const compactModel = () => process.env.ASSISTANT_COMPACT_MODEL || 'gpt-5-mini';

/** 요약 입력 전체 예산(자). 요약 모델의 컨텍스트 안에 들어가야 한다. */
const MAX_TRANSCRIPT_CHARS = 40_000;

/** 메시지 한 줄의 상한(자). 긴 도구 결과 하나가 예산을 독차지하는 것을 막는다. */
const MAX_LINE_CHARS = 2_000;

/**
 * 한 줄에 이만큼도 못 주면 접기를 포기한다. 식별자 하나도 안 들어가는 요약은
 * 만들어 봐야 다음 턴이 쓸 수 없고, 원문은 이미 경계 뒤로 사라진 뒤다.
 */
const MIN_USEFUL_LINE_CHARS = 60;

const SUMMARY_PROMPT = `당신은 대화 기록을 접는 일을 한다. 아래는 어드민이 AI 어시스턴트와 나눈 대화다.
다음 턴에 필요한 사실만 남겨 간결하게 정리하라.

반드시 지킬 것:
- 식별자를 그대로 옮긴다 — masterId, versionId, fileId, 세션 id, 상품코드. 이것을 잃으면
  다음 턴이 이미 한 일을 처음부터 다시 한다.
- 무엇을 했는지 (등록·수정·삭제·발행), 무엇이 정해졌는지 (가격·카테고리·옵션),
  무엇이 남았는지 (사용자가 답하기로 한 것, 보류한 것) 를 적는다.
- 실패한 작업과 그 이유도 남긴다. 그래야 같은 실패를 되풀이하지 않는다.
- 인사말·확인 문구·이미 끝난 잡담은 버린다.
- 추측하지 않는다. 대화에 없는 것을 지어내지 않는다.

200자 내외의 한국어 평문으로 쓴다. 목록이 필요하면 짧은 줄로 나눈다.`;

/** 접기 판단에 필요한 세션 정보. 전체 행이 아니라 이 셋만 있으면 된다. */
export type CompactTarget = {
  id: string;
  summary: string | null;
  summarizedThrough: Date | null;
};

/**
 * 메시지 하나를 요약 모델이 읽을 한 줄로 옮긴다.
 *
 * 도구 호출과 그 결과를 반드시 싣는다 — masterId·versionId·fileId 같은 식별자는
 * 사람이 쓴 문장이 아니라 전부 도구 쪽에 있다. user/assistant 텍스트만 넘기면
 * "식별자를 그대로 옮기라" 는 지시가 옮길 대상 자체를 못 받는다.
 */
export function describeForSummary(message: Message): string {
  if (message.role === 'tool') {
    // 상품 목록 20건이나 엑셀 처리 결과는 한 줄이 수만 자다. 통째로 넣으면 그 하나가
    // 요약 입력 예산을 다 먹고 뒤 대화가 밀려난다. 식별자는 앞쪽에 오므로 앞을 남긴다.
    return `도구결과: ${clamp(asText(message.content), MAX_LINE_CHARS)}`;
  }

  if (message.role === 'assistant') {
    const calls = message.tool_calls
      ?.map((call) => ('function' in call ? `${call.function.name}(${call.function.arguments})` : call.type))
      .join(' ');
    const said = asText(message.content);
    // 도구만 부르고 말이 없는 턴이 있다. 그때 content 는 null 이라 그대로 찍으면 "null" 이 된다.
    return ['assistant:', said, calls && `도구호출: ${calls}`].filter(Boolean).join(' ');
  }

  return `${message.role}: ${clamp(asText(message.content), MAX_LINE_CHARS)}`;
}

/**
 * 잘렸다는 사실을 남긴다 — 요약 모델이 "여기서 끊겼다" 를 알아야 지어내지 않는다.
 *
 * 결과 길이가 limit 을 넘지 않는다. 접미사를 limit 밖에 붙이면 줄마다 예산을 조금씩
 * 초과하고, 줄이 많을수록 그 합이 커져 뒤쪽 줄이 통째로 잘려나간다.
 */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const dropped = text.length - limit;
  const suffix = `…(생략 ${dropped}자)`;
  // 접미사조차 안 들어갈 만큼 좁으면 본문만 남긴다.
  const head = limit - suffix.length;
  return head > 0 ? `${text.slice(0, head)}${suffix}` : text.slice(0, limit);
}

/**
 * 요약 입력 예산에 들어가는 앞부분만 고르고, 그 구간의 transcript 를 함께 돌려준다.
 *
 * 크기를 재는 것과 실제로 모델에 넣는 것이 같은 문자열이어야 한다. 따로 만들면
 * closeDanglingToolCalls 가 단독 행에만 가짜 도구 결과를 붙여 추정과 실제가 어긋나고,
 * 그만큼 예산을 넘는다.
 *
 * 메시지 단위로 끊는다 — 글자 단위로 자르면 도구 결과 한가운데가 잘려 식별자가 반토막 난다.
 */
function foldWithinBudget(candidates: MessageRow[]): { fold: MessageRow[]; transcript: string } {
  const picked: MessageRow[] = [];
  const lines: string[] = [];
  let used = 0;

  for (const row of candidates) {
    const rowLines = restoreConversation([row]).map(describeForSummary);
    const size = rowLines.reduce((total, line) => total + line.length + 1, 0);

    if (used + size > MAX_TRANSCRIPT_CHARS) {
      // 행 하나가 예산을 통째로 넘을 수 있다 — contentBlocks 는 여러 메시지로 펼쳐지므로
      // 도구를 열 번 돈 턴이면 줄 상한을 지켜도 합계가 예산을 넘는다.
      // 접기를 포기하면 그 세션은 영영 못 접고 계속 커지므로, 그 행 하나만 접는다.
      //
      // 이때 앞부분만 남기고 자르면 안 된다 — 경계가 이 행이라 이 행은 원문에서 빠지는데,
      // 잘려나간 후반부는 요약에도 없어 그대로 사라진다. 모든 줄을 균등하게 줄여
      // 전체가 요약 입력에 들어가게 한다. 식별자는 각 줄 앞쪽이라 살아남는다.
      if (picked.length === 0) {
        // 줄바꿈 몫까지 빼고 나눈다. 하한을 두면 줄이 많을 때 그 하한 × 줄수 가 예산을
        // 넘고, 마지막 slice 가 뒤쪽 줄을 통째로 잘라 후반부 식별자가 사라진다.
        const perLine = Math.floor(MAX_TRANSCRIPT_CHARS / rowLines.length) - 1;

        // 줄 수가 너무 많아 한 줄에 몇 자도 못 주면, 접어 봐야 요약이 의미를 잃는다.
        // 그때는 접지 않는다 — 대화가 계속 커지는 편이 정보를 잃는 것보다 낫다.
        if (perLine < MIN_USEFUL_LINE_CHARS) break;

        picked.push(row);
        lines.push(...rowLines.map((line) => clamp(line, perLine)));
      }
      break;
    }

    picked.push(row);
    lines.push(...rowLines);
    used += size;
  }

  // 마지막 안전망. 위에서 줄마다 예산을 나눠 가졌으므로 보통은 걸리지 않는다.
  return { fold: picked, transcript: lines.join('\n').slice(0, MAX_TRANSCRIPT_CHARS) };
}

function asText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  return JSON.stringify(content);
}

@Injectable()
export class ConversationCompactorService {
  private readonly logger = new Logger(ConversationCompactorService.name);

  constructor(private readonly repository: AssistantChatRepository) {}

  /**
   * 필요할 때만 접는다. 실패해도 조용히 넘어간다 — 접기는 비용을 줄이는 일이지
   * 대화를 성립시키는 일이 아니다. 여기서 던지면 방금 끝난 답변까지 에러로 보인다.
   */
  async compactIfNeeded(session: CompactTarget): Promise<void> {
    try {
      // 이미 접힌 구간은 다시 보지 않는다. 전체로 재면 한 번 접은 뒤에도 전체는 계속
      // 커서 매 턴 재요약이 돌고, 이미 요약된 구간을 또 요약한다.
      const rows = session.summarizedThrough
        ? await this.repository.findMessagesAfter(session.id, session.summarizedThrough)
        : await this.repository.findMessages(session.id);
      if (rows.length <= keepRecent()) return;

      // 판정도 모델에 실제 실리는 것을 기준으로 한다 — 요약 한 덩이 + 접히지 않은 메시지.
      const carried = restoreConversation(rows);
      const summaryTokens = session.summary ? estimateTokens([{ role: 'user', content: session.summary }]) : 0;
      if (estimateTokens(carried) + summaryTokens < thresholdTokens()) return;

      // 예산 안에 들어가는 만큼만 접는다. 요약 입력을 뒤에서 잘라놓고 경계는 전체 끝으로
      // 잡으면, 잘려나간 구간이 요약에도 없고 원문에서도 빠져 영영 사라진다.
      // 남은 구간은 다음 턴의 접기가 가져간다.
      const { fold, transcript } = foldWithinBudget(rows.slice(0, rows.length - keepRecent()));
      const boundary = fold.at(-1)?.createdAt;
      if (!boundary) return;

      const summary = await this.summarize(transcript, session.summary);
      if (!summary) return;

      await this.repository.saveSummary(session.id, summary, boundary);
      this.logger.log(`대화 접음 sessionId=${session.id} 접은메시지=${fold.length} 남긴메시지=${keepRecent()}`);
    } catch (err) {
      this.logger.warn(`대화 접기 실패 (대화는 계속된다): ${(err as Error)?.message?.slice(0, 200)}`);
    }
  }

  /**
   * 이전 요약도 함께 넘긴다. 빼면 두 번째 접기에서 첫 번째로 접은 내용이 사라진다 —
   * 요약의 요약이 되는 것이 맞고, 원문은 이미 대화에서 빠져 있다.
   */
  private async summarize(transcript: string, previousSummary: string | null): Promise<string | null> {
    const response = await getOpenAiClient().chat.completions.create({
      model: compactModel(),
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        {
          role: 'user',
          content: previousSummary
            ? `[앞서 접어 둔 요약]\n${previousSummary}\n\n[새로 접을 대화]\n${transcript}`
            : transcript,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || null;
  }
}
