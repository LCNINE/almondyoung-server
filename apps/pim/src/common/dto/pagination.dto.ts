import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * 페이지네이션 응답 DTO (제네릭)
 *
 * Swagger가 제네릭을 처리할 수 없으므로, data 필드는 @ApiProperty를 사용하지 않습니다.
 * 대신 ApiOkResponsePaginated 데코레이터를 사용하여 올바른 스키마를 생성합니다.
 *
 * @template T - 데이터 아이템 타입
 *
 * @example
 * ```typescript
 * // Controller에서 사용
 * @Get()
 * @ApiOkResponsePaginated(ProductMasterDto)
 * async getMasters(): Promise<PaginatedResponseDto<ProductMasterDto>> {
 *   // ...
 * }
 * ```
 */
export class PaginatedResponseDto<T> {
  /**
   * 데이터 배열
   * Swagger 스키마는 ApiOkResponsePaginated 데코레이터에서 생성됩니다.
   */
  data: T[];

  @ApiProperty({
    description: '전체 아이템 수',
    example: 100,
    minimum: 0,
  })
  total: number;

  @ApiProperty({
    description: '현재 페이지 번호 (1부터 시작)',
    example: 1,
    minimum: 1,
  })
  page: number;

  @ApiProperty({
    description: '페이지당 아이템 수',
    example: 20,
    minimum: 1,
  })
  limit: number;
}

/**
 * 페이지네이션 요청 쿼리 파라미터
 */
export class PaginationQueryDto {
  @ApiProperty({
    description: '페이지 번호 (1부터 시작)',
    required: false,
    default: 1,
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: '페이지당 아이템 수',
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;
}
