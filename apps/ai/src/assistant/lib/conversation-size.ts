import type { Message } from './conversation';

/**
 * 대화 크기를 토큰 수로 어림잡는다.
 *
 * 정확한 토큰 수가 필요하면 tokenizer 를 붙여야 하지만, 여기 쓰임은 "접을 때가 됐는가"
 * 하나뿐이라 그 정확도가 필요 없다. 한국어는 대략 1.2자, JSON·영문은 4자에 1토큰이라
 * 섞인 대화를 2.5자당 1토큰으로 본다. 실제보다 넉넉히 잡히는 쪽이라 늦게 접히지 않는다.
 */
const CHARS_PER_TOKEN = 2.5;

export function estimateTokens(messages: Message[]): number {
  return Math.round(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}
