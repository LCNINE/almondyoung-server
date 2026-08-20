import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { updateCustomersWorkflow } from '@medusajs/core-flows';
import {
  buildClearedDefaultShippingMemoMetadata,
  buildDefaultShippingMemoMetadata,
} from './metadata';

interface UpdateDefaultShippingMemoBody {
  shipping_memo_type: string;
  shipping_memo_custom?: string;
  has_entrance?: boolean;
}

/**
 * POST /store/customers/me/default-shipping-memo
 * 고객 프로필에 기본 배송 메모를 저장합니다.
 *
 * Body:
 * - shipping_memo_type: string (필수) - 배송 메모 타입 (예: 'door', 'security', 'custom' 등)
 * - shipping_memo_custom?: string (선택) - 커스텀 메모 내용 (type이 'custom'인 경우 사용)
 * - has_entrance?: boolean (선택) - 공동출입문 유무
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const { shipping_memo_type, shipping_memo_custom, has_entrance } =
    req.body as UpdateDefaultShippingMemoBody;

  if (!shipping_memo_type) {
    return res.status(400).json({
      message: 'shipping_memo_type is required',
    });
  }

  try {
    // Medusa 가 metadata 를 병합하므로 바꿀 키만 보낸다. 기존 값을 읽어 되돌려보내면
    // 그 사이 다른 요청이 쓴 값을 덮는 race 만 는다.
    const metadata = buildDefaultShippingMemoMetadata({
      shipping_memo_type,
      shipping_memo_custom,
      has_entrance,
    });

    await updateCustomersWorkflow(req.scope).run({
      input: { selector: { id: customerId }, update: { metadata } },
    });

    return res.status(200).json({
      success: true,
      default_shipping_memo: {
        shipping_memo_type,
        shipping_memo_custom: metadata.default_shipping_memo_custom,
        has_entrance: metadata.default_has_entrance,
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

  try {
    // 키를 뺀 객체를 보내는 방식은 동작하지 않는다 — Medusa 는 metadata 를 병합하므로
    // "없는 키" 는 손대지 않는 것으로 해석되어 옛 값이 그대로 남는다. 빈 문자열이 삭제다.
    await updateCustomersWorkflow(req.scope).run({
      input: {
        selector: { id: customerId },
        update: { metadata: buildClearedDefaultShippingMemoMetadata() },
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
