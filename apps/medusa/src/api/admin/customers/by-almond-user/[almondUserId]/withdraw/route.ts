import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { withdrawCustomerWorkflow } from '../../../../../../workflows/customers/withdraw-customer';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /admin/customers/by-almond-user/:almondUserId/withdraw
 *
 * 탈퇴 회원의 Medusa 흔적 파기. channel-adapter 가 `UserDeleted` inbox 에서 부른다 (#786).
 * 코어 `/admin/customers/:id` 와 충돌하지 않도록 이미 공존 중인 `by-almond-user` 아래에 둔다.
 * 키가 userId 인 이유와 파기 범위는 `workflows/customers/withdraw-customer.ts` 머리 참고.
 *
 * 멱등: 같은 userId 로 몇 번을 불러도 두 번째부터는 `not_found`/0 이다. 고객 없음은 4xx 가 아니라 200 이다 —
 * 한 번도 로그인 안 한 회원이 정상 케이스이고, 4xx 를 내면 channel-adapter inbox 가 영구 실패로 남긴다.
 *
 * 여기엔 입력 검증·응답 모양만 남고 판정·쓰기는 워크플로가 한다 (ADR-0034 결정 3).
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { almondUserId } = req.params;
  if (!UUID_V4.test(almondUserId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `almondUserId must be a UUID: ${almondUserId}`);
  }

  const { result } = await withdrawCustomerWorkflow(req.scope).run({ input: { almondUserId } });

  res.status(200).json(result);
};
