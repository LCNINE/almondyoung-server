// Admin REST API 모양(MedusaProductPayload) → in-process 워크플로우 input(CreateProductWorkflowInputDTO).
//
// `transformPimToMedusa` 의 출력은 Medusa Admin REST 컨트랙트(`AdminCreateProduct`) 에 맞춰져 있다
// (`categories: [{id}]`, `tags: [{value}]`). 채널어댑터 정상 동기화 흐름은 그 모양을 그대로
// `sdk.admin.product.create` 에 넘긴다.
//
// 반면 `createProductsWorkflow` 는 모듈 DTO(`CreateProductDTO`) 모양을 받는다 — 즉
// `category_ids: string[]`, `tag_ids: string[]`. 두 경로의 모양을 한 곳에서 변환한다.
import type { MedusaProductPayload } from './transformer';

export interface WorkflowProductInput extends Omit<MedusaProductPayload, 'categories' | 'tags'> {
  category_ids?: string[];
  tag_ids?: string[];
}

export interface AdaptOptions {
  // tag value → tag id 해석. 누락되면 그 태그는 drop. 호출 측에서 미리 prime 하는 것이 보통.
  resolveTagId?: (value: string) => string | undefined;
}

export function toWorkflowInput(payload: MedusaProductPayload, options: AdaptOptions = {}): WorkflowProductInput {
  const { categories, tags, ...rest } = payload;

  const category_ids = categories?.map((c) => c.id).filter((id): id is string => Boolean(id));
  const tag_ids = tags
    ?.map((t) => t.id ?? options.resolveTagId?.(t.value))
    .filter((id): id is string => Boolean(id));

  return {
    ...rest,
    ...(category_ids && category_ids.length > 0 ? { category_ids } : {}),
    ...(tag_ids && tag_ids.length > 0 ? { tag_ids } : {}),
  };
}
