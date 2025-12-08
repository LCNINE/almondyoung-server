# 페이지네이션 제네릭 패턴 사용 가이드

## 문제 상황

TypeScript의 제네릭은 런타임에 타입 정보가 지워지기 때문에, NestJS의 Swagger가 제네릭 DTO를 자동으로 처리할 수 없습니다.

```typescript
// ❌ 이렇게 하면 Swagger가 제대로 동작하지 않음
export class PaginatedResponseDto<T> {
  @ApiProperty()
  data: T[];  // Swagger가 T를 인식하지 못함

  @ApiProperty()
  total: number;
}
```

## 해결 방법

OpenAPI 스키마를 수동으로 생성하는 커스텀 데코레이터를 사용합니다.

---

## 1. 공통 타입 사용하기

### PaginatedResponseDto

```typescript
import { PaginatedResponseDto } from '../../../common/dto';

// 서비스에서 반환
async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
  return {
    data: [/* ... */],
    total: 100,
    page: 1,
    limit: 20,
  };
}
```

### PaginationQueryDto

```typescript
import { PaginationQueryDto } from '../../../common/dto';

// 쿼리 파라미터로 사용
@Get()
async getMasters(@Query() query: PaginationQueryDto) {
  // query.page, query.limit 사용 가능
}
```

---

## 2. 커스텀 데코레이터 사용하기

### ApiOkResponsePaginated

**기본 사용:**

```typescript
import { ApiOkResponsePaginated } from '../../../common/decorators';
import { PaginatedResponseDto } from '../../../common/dto';

@Controller('products')
export class ProductsController {
  @Get()
  @ApiOkResponsePaginated(MasterListItemDto, {
    description: '제품 마스터 목록 조회 성공',
  })
  async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
    // ...
  }
}
```

**Before (기존 패턴):**

```typescript
@Get()
@ApiResponse({
  status: 200,
  description: '제품 마스터 목록 조회 성공',
  type: MasterListResponseDto,  // 전용 DTO 필요
})
async getMasters(): Promise<MasterListResponseDto> {
  // MasterListResponseDto를 별도로 정의해야 함
}
```

**After (제네릭 패턴):**

```typescript
@Get()
@ApiOkResponsePaginated(MasterListItemDto, {
  description: '제품 마스터 목록 조회 성공',
})
async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
  // 제네릭 타입 재사용, 전용 DTO 불필요
}
```

### ApiCreatedResponsePaginated

201 Created 응답에 사용:

```typescript
@Post('bulk')
@ApiCreatedResponsePaginated(ProductDto, {
  description: '제품 일괄 생성 성공',
})
async bulkCreate(
  @Body() createDto: BulkCreateDto
): Promise<PaginatedResponseDto<ProductDto>> {
  // ...
}
```

---

## 3. 실제 사용 예시

### 컨트롤러 전체 예시

```typescript
import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiOkResponsePaginated } from '../../../common/decorators';
import { PaginatedResponseDto, PaginationQueryDto } from '../../../common/dto';
import { ProductMasterDto } from '../dto';
import { ProductMastersService } from '../services/product-masters.service';

@ApiTags('Product Masters')
@Controller('masters')
export class ProductMastersController {
  constructor(
    private readonly productMastersService: ProductMastersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '제품 마스터 목록 조회',
    description: '제품 마스터 목록을 페이지네이션과 함께 조회합니다.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '페이지 번호',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '페이지 당 아이템 수',
  })
  @ApiOkResponsePaginated(ProductMasterDto, {
    description: '제품 마스터 목록 조회 성공',
  })
  async getMasters(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<ProductMasterDto>> {
    return this.productMastersService.getMasters(query);
  }
}
```

### 서비스 예시

```typescript
import { Injectable } from '@nestjs/common';
import { PaginatedResponseDto, PaginationQueryDto } from '../../../common/dto';
import { ProductMasterDto } from '../dto';

@Injectable()
export class ProductMastersService {
  async getMasters(
    query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<ProductMasterDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // 데이터베이스 조회
    const [data, total] = await Promise.all([
      this.db.query.productMasters.findMany({
        limit,
        offset,
      }),
      this.db.query.productMasters.count(),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
```

---

## 4. 생성된 Swagger 문서

위 패턴을 사용하면 Swagger UI에서 다음과 같이 표시됩니다:

```json
{
  "data": [
    {
      "id": "uuid-1",
      "name": "제품 1",
      "description": "설명",
      "createdAt": "2025-12-05T10:30:00.000Z",
      "updatedAt": "2025-12-05T10:30:00.000Z"
    },
    {
      "id": "uuid-2",
      "name": "제품 2",
      "description": "설명",
      "createdAt": "2025-12-05T10:30:00.000Z",
      "updatedAt": "2025-12-05T10:30:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

**OpenAPI 스키마:**

```yaml
PaginatedResponseDto_ProductMasterDto:
  type: object
  allOf:
    - $ref: '#/components/schemas/PaginatedResponseDto'
    - type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ProductMasterDto'
```

---

## 5. 기존 코드 마이그레이션

### Step 1: Import 변경

```typescript
// Before
import { MasterListResponseDto } from '../dto';

// After
import { PaginatedResponseDto } from '../../../common/dto';
import { ApiOkResponsePaginated } from '../../../common/decorators';
```

### Step 2: 데코레이터 교체

```typescript
// Before
@ApiResponse({
  status: 200,
  description: '목록 조회 성공',
  type: MasterListResponseDto,
})

// After
@ApiOkResponsePaginated(MasterListItemDto, {
  description: '목록 조회 성공',
})
```

### Step 3: 반환 타입 변경

```typescript
// Before
async getMasters(): Promise<MasterListResponseDto> {
  // ...
}

// After
async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
  // ...
}
```

### Step 4: 전용 DTO 제거 (선택)

기존에 만들었던 `*ListResponseDto`는 제거하거나, 필요시 `PaginatedResponseDto`를 확장하여 사용:

```typescript
// 추가 필드가 필요한 경우
export class MasterListResponseDto extends PaginatedResponseDto<MasterListItemDto> {
  @ApiProperty({ description: '필터 정보' })
  filters: FilterInfo;
}
```

---

## 6. 주의사항

### ❌ 하지 말아야 할 것

```typescript
// ❌ PaginatedResponseDto의 data 필드에 @ApiProperty 추가
export class PaginatedResponseDto<T> {
  @ApiProperty()  // ❌ 이렇게 하면 안 됨
  data: T[];
}

// ❌ 제네릭 DTO에 직접 @ApiResponse 사용
@ApiResponse({
  type: PaginatedResponseDto,  // ❌ 타입 정보 손실
})
```

### ✅ 해야 할 것

```typescript
// ✅ ApiOkResponsePaginated 데코레이터 사용
@ApiOkResponsePaginated(MasterListItemDto, {
  description: '목록 조회 성공',
})

// ✅ 구체적인 타입 명시
async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
  // ...
}
```

---

## 7. 커스텀 데코레이터 확장

다른 HTTP 상태 코드가 필요한 경우:

```typescript
// apps/pim/src/common/decorators/api-paginated-response.decorator.ts

/**
 * Accepted 응답을 위한 페이지네이션 데코레이터 (202)
 */
export const ApiAcceptedResponsePaginated = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: Omit<ApiResponseOptions, 'schema'>,
) =>
  applyDecorators(
    ApiExtraModels(PaginatedResponseDto, dataDto),
    ApiAcceptedResponse({
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
```

---

## 8. 참고 자료

- [NestJS OpenAPI - Extra Models](https://docs.nestjs.com/openapi/types-and-parameters#extra-models)
- [OpenAPI 3.0 - Inheritance and Polymorphism](https://swagger.io/docs/specification/data-models/inheritance-and-polymorphism/)
- [TypeScript - Generic Types](https://www.typescriptlang.org/docs/handbook/2/generics.html)

---

## 9. 트러블슈팅

### Q: Swagger UI에서 data 필드가 제대로 표시되지 않아요

**A:** `@ApiExtraModels`에 DTO를 등록했는지 확인하세요.

```typescript
@ApiOkResponsePaginated(MasterListItemDto, { /* ... */ })
//                       ^^^^^^^^^^^^^^^^
//                       이 DTO의 스키마가 생성됩니다
```

### Q: TypeScript에서 타입 에러가 발생해요

**A:** 반환 타입을 제네릭으로 명시했는지 확인하세요.

```typescript
// ❌
async getMasters(): Promise<PaginatedResponseDto> {
  // Type 'PaginatedResponseDto' is not generic

// ✅
async getMasters(): Promise<PaginatedResponseDto<MasterListItemDto>> {
  // OK
```

### Q: 기존 DTO를 모두 수정해야 하나요?

**A:** 아니요. 점진적으로 마이그레이션하면 됩니다. 새로운 API부터 적용하고, 기존 API는 필요할 때 수정하세요.

---

## 변경 이력

| 일자 | 버전 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 2025-12-06 | 1.0.0 | 초안 작성 | Claude |
