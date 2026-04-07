import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { updateCustomersWorkflow } from '@medusajs/core-flows';

interface UpdateDefaultShippingMemoBody {
  shipping_memo_type: string;
  shipping_memo_custom?: string;
  entrance_password?: string;
  has_entrance?: boolean;
}

/**
 * POST /store/customers/me/default-shipping-memo
 * 고객 프로필에 기본 배송 메모를 저장합니다.
 *
 * Body:
 * - shipping_memo_type: string (필수) - 배송 메모 타입 (예: 'door', 'security', 'custom' 등)
 * - shipping_memo_custom?: string (선택) - 커스텀 메모 내용 (type이 'custom'인 경우 사용)
 * - entrance_password?: string (선택) - 공동출입문 비밀번호 (type이 'door'인 경우 사용)
 * - has_entrance?: boolean (선택) - 공동출입문 유무
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const { shipping_memo_type, shipping_memo_custom, entrance_password, has_entrance } =
    req.body as UpdateDefaultShippingMemoBody;

  if (!shipping_memo_type) {
    return res.status(400).json({
      message: 'shipping_memo_type is required',
    });
  }

  const query = req.scope.resolve<any>(ContainerRegistrationKeys.QUERY);

  try {
    // 기존 고객 정보 조회
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'metadata'],
      filters: { id: customerId },
    });

    const existingMetadata = (customers?.[0]?.metadata as Record<string, unknown>) ?? {};

    // metadata 업데이트 (기존 metadata 유지하면서 배송 메모 추가/수정)
    await updateCustomersWorkflow(req.scope).run({
      input: {
        selector: { id: customerId },
        update: {
          metadata: {
            ...existingMetadata,
            default_shipping_memo_type: shipping_memo_type,
            default_shipping_memo_custom: shipping_memo_custom ?? '',
            default_entrance_password: entrance_password ?? '',
            default_has_entrance: has_entrance ?? false,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      default_shipping_memo: {
        shipping_memo_type,
        shipping_memo_custom: shipping_memo_custom ?? '',
        entrance_password: entrance_password ?? '',
        has_entrance: has_entrance ?? false,
      },
    });
  } catch (error) {
    console.error('[POST /store/customers/me/default-shipping-memo] Failed to update:', error);
    return res.status(500).json({
      message: 'Failed to update default shipping memo',
    });
  }
}

/**
 * DELETE /store/customers/me/default-shipping-memo
 * 고객 프로필에서 기본 배송 메모를 삭제합니다.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve<any>(ContainerRegistrationKeys.QUERY);

  try {
    // 기존 고객 정보 조회
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'metadata'],
      filters: { id: customerId },
    });

    const existingMetadata = (customers?.[0]?.metadata as Record<string, unknown>) ?? {};

    // 배송 메모 필드 제거
    const {
      default_shipping_memo_type,
      default_shipping_memo_custom,
      default_entrance_password,
      default_has_entrance,
      ...restMetadata
    } = existingMetadata;

    await updateCustomersWorkflow(req.scope).run({
      input: {
        selector: { id: customerId },
        update: {
          metadata: restMetadata,
        },
      },
    });

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error('[DELETE /store/customers/me/default-shipping-memo] Failed to delete:', error);
    return res.status(500).json({
      message: 'Failed to delete default shipping memo',
    });
  }
}

/**
 * GET /store/customers/me/default-shipping-memo
 * 고객 프로필에 저장된 기본 배송 메모를 조회합니다.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve<any>(ContainerRegistrationKeys.QUERY);

  try {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'metadata'],
      filters: { id: customerId },
    });

    const metadata = (customers?.[0]?.metadata as Record<string, unknown>) ?? {};
    const shippingMemoType = metadata.default_shipping_memo_type as string | undefined;
    const shippingMemoCustom = metadata.default_shipping_memo_custom as string | undefined;
    const entrancePassword = metadata.default_entrance_password as string | undefined;
    const hasEntrance = metadata.default_has_entrance as boolean | undefined;

    if (!shippingMemoType) {
      return res.status(200).json({
        default_shipping_memo: null,
      });
    }

    return res.status(200).json({
      default_shipping_memo: {
        shipping_memo_type: shippingMemoType,
        shipping_memo_custom: shippingMemoCustom ?? '',
        entrance_password: entrancePassword ?? '',
        has_entrance: hasEntrance ?? false,
      },
    });
  } catch (error) {
    console.error('[GET /store/customers/me/default-shipping-memo] Failed to get:', error);
    return res.status(500).json({
      message: 'Failed to get default shipping memo',
    });
  }
}
