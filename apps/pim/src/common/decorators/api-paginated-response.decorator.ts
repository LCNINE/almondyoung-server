import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiCreatedResponse,
  getSchemaPath,
  ApiResponseOptions,
} from '@nestjs/swagger';
import { PaginatedResponseDto } from '../dto/pagination.dto';

/**
 * Swagger를 위한 페이지네이션 응답 데코레이터
 *
 * TypeScript의 제네릭은 런타임에 지워지기 때문에 Swagger가 자동으로 처리할 수 없습니다.
 * 이 데코레이터는 OpenAPI 스키마를 수동으로 생성하여 제네릭 타입을 올바르게 표현합니다.
 *
 * @param dataDto - data 배열의 아이템 타입 (DTO 클래스)
 * @param options - 추가 ApiResponse 옵션 (description 등)
 *
 * @example
 * ```typescript
 * @Controller('products')
 * export class ProductsController {
 *   @Get()
 *   @ApiOkResponsePaginated(ProductMasterDto, {
 *     description: '제품 마스터 목록 조회 성공'
 *   })
 *   async getMasters(): Promise<PaginatedResponseDto<ProductMasterDto>> {
 *     // ...
 *   }
 * }
 * ```
 */
export const ApiOkResponsePaginated = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: Omit<ApiResponseOptions, 'schema'>,
) =>
  applyDecorators(
    // PaginatedResponseDto와 dataDto의 OpenAPI 스키마를 생성하도록 지시
    ApiExtraModels(PaginatedResponseDto, dataDto),
    ApiOkResponse({
      ...options,
      schema: {
        // allOf는 OpenAPI 3의 상속/합성 표현 방식
        allOf: [
          // PaginatedResponseDto의 기본 구조 (total, page, limit)
          { $ref: getSchemaPath(PaginatedResponseDto) },
          // data 필드를 dataDto 타입의 배열로 오버라이드
          {
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(dataDto) },
                description: options?.description
                  ? `${options.description}의 데이터 목록`
                  : '데이터 목록',
              },
            },
          },
        ],
      },
    }),
  );

/**
 * Created 응답을 위한 페이지네이션 데코레이터 (201)
 */
export const ApiCreatedResponsePaginated = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: Omit<ApiResponseOptions, 'schema'>,
) =>
  applyDecorators(
    ApiExtraModels(PaginatedResponseDto, dataDto),
    ApiCreatedResponse({
      ...options,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(dataDto) },
              },
            },
          },
        ],
      },
    }),
  );
