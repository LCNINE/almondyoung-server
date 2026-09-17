import { RequireScopes } from '@app/authorization';
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clientAbortSignal } from '../../assistant/lib/client-abort';
import { callerAuthHeaders } from '../../assistant/lib/multipart';
import { ComposeDescriptionDto } from '../dto/compose-description.dto';
import { ExtractFactsDto } from '../dto/extract-facts.dto';
import { ProductDescriptionService } from '../services/product-description.service';
import { AI_SCOPE } from '../../platform/auth/ai-scopes';

/**
 * 상품 상세설명 AI 초안. 어드민 상품 상세 화면의 "AI 초안" 버튼과
 * 어시스턴트의 write_product_description 도구가 같은 코드를 쓴다.
 *
 * 두 단계로 나뉜 이유는 `@packages/product-description` 의 draft.ts 주석 참조 —
 * 한 호출로 다 시키면 60초를 넘겨 CloudFront 가 끊는다.
 */
@ApiTags('AI 상품 상세설명')
@ApiBearerAuth()
@RequireScopes(AI_SCOPE.ASSISTANT)
@ApiResponse({ status: 403, description: 'ai:assistant 스코프가 필요합니다 (어드민 전용).' })
@Controller('product-description')
export class ProductDescriptionController {
  constructor(private readonly service: ProductDescriptionService) {}

  @Post('extract')
  @ApiOperation({ summary: '이미지에서 사실 추출' })
  async extract(@Body() dto: ExtractFactsDto, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const result = await this.service.extract(dto, callContext(request, reply));
    return sendWebResponse(reply, result);
  }

  @Post('compose')
  @ApiOperation({ summary: '추출 결과로 상세 본문 작성' })
  async compose(@Body() dto: ComposeDescriptionDto, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const result = await this.service.compose(dto, callContext(request, reply));
    return sendWebResponse(reply, result);
  }
}

/** 브라우저가 끊으면 Anthropic 호출도 멈춘다 — 이 둘은 30초 넘게 걸린다. */
function callContext(request: FastifyRequest, reply: FastifyReply) {
  return { authHeaders: callerAuthHeaders(request), signal: clientAbortSignal(reply) };
}

/**
 * 서비스가 웹 표준 `Response` 를 돌려준다 (어시스턴트 도구가 같은 함수를 직접 부르므로
 * HTTP 프레임워크에 묶지 않았다). 여기서만 Fastify 응답으로 옮긴다.
 */
async function sendWebResponse(reply: FastifyReply, response: Response) {
  const text = await response.text();
  reply
    .status(response.status)
    .header('Content-Type', response.headers.get('Content-Type') ?? 'application/json')
    .send(text);
}
