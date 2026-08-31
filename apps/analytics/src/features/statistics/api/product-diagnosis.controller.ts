import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { ProductDiagnosis, ProductDiagnosisQuery } from '../read-model/product-diagnosis.query';
import { ProductDiagnosisQueryDto } from './statistics-query.dto';

/**
 * 상품 단건 진단(카르테)의 매출·마진 축. admin-web 프록시를 통해서만 호출된다.
 * 마진(공급가 파생)을 실어 내리므로 이익 통계와 같은 가드 짝(JwtAuthGuard + AdminRealmGuard)을 쓴다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class ProductDiagnosisController {
  constructor(private readonly diagnosisQuery: ProductDiagnosisQuery) {}

  @Get('products/:masterId/diagnosis')
  @ApiOperation({
    summary: '상품 단건 진단 (매출·마진)',
    description:
      '상품 하나의 기간 매출·수량·직전 기간 대비·추정 마진과 옵션별 판매를 낸다. ' +
      'benchmark 는 전사 이익 요약(이익 탭과 같은 값)이며 masterId 로 좁혀지지 않는다 — 비교 기준이기 때문이다. ' +
      '집계에 없는 상품이면 404 가 아니라 0 으로 채운 응답을 준다(다른 축은 정상 표시되어야 한다).',
  })
  getDiagnosis(
    @Param('masterId') masterId: string,
    @Query() query: ProductDiagnosisQueryDto,
  ): Promise<ProductDiagnosis> {
    const trimmed = masterId?.trim();
    if (!trimmed) {
      throw new BadRequestException('masterId 는 필수입니다');
    }
    return this.diagnosisQuery.getDiagnosis(trimmed, query.from, query.to, query.channel);
  }
}
