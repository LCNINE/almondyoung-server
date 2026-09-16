import { Injectable } from '@nestjs/common';
import { getAnthropicClient } from './anthropic';
import { composeProductDescription } from './compose';
import { extractProductFacts } from './extract';
import type { ComposeDescriptionDto } from '../dto/compose-description.dto';
import type { ExtractFactsDto } from '../dto/extract-facts.dto';

export type CallContext = {
  /** Core 의 프롬프트 양식을 읽을 때 실을 인증. 부른 사람의 것을 그대로 쓴다. */
  authHeaders: Record<string, string>;
  signal: AbortSignal;
};

/**
 * 상품 상세설명 초안의 두 단계.
 *
 * 두 함수가 웹 표준 `Response` 를 돌려주는 것은 의도다 — 어시스턴트의
 * write_product_description 도구가 HTTP 를 타지 않고 같은 함수를 직접 부른다.
 */
@Injectable()
export class ProductDescriptionService {
  extract(dto: ExtractFactsDto, ctx: CallContext): Promise<Response> {
    return extractProductFacts(getAnthropicClient(), dto.fileIds, ctx.signal);
  }

  compose(dto: ComposeDescriptionDto, ctx: CallContext): Promise<Response> {
    return composeProductDescription(getAnthropicClient(), dto, ctx);
  }
}
