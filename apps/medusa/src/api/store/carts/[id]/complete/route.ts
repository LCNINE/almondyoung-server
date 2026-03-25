import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { MedusaError } from '@medusajs/utils';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cart_id = req.params.id;

  const { errors, result } = await completeCartWorkflow(req.scope).run({
    input: { id: cart_id },
    context: { transactionId: cart_id },
    throwOnError: false,
  });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 워크플로우에서 에러가 발생하면, 이는 주로 장바구니 유효성 검사, 결제,
  // 또는 재고 확인과 관련이 있습니다. 여기서는 소비자가 추가 조치를 취하고
  // 문제를 해결할 수 있도록 에러와 함께 장바구니를 반환합니다.
  if (errors?.[0]) {
    const error = errors[0].error;
    const statusOKErrors: string[] = [
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR,
    ];

    // statusOKErrors 목록에 없는 에러가 발생하면, 이는 장바구니가 완료될 수 있는
    // 상태가 아니라는 의미입니다. 이런 경우에는 400 에러를 반환합니다.
    const cart = await refetchCart(
      cart_id,
      req.scope,
      (
        await prepareRetrieveQuery(
          {},
          {
            defaults: defaultStoreCartFields,
          },
        )
      ).remoteQueryConfig.fields,
    );

    if (!statusOKErrors.includes(error.type)) {
      throw error;
    }

    res.status(200).json({
      type: 'cart',
      cart,
      error: {
        message: error.message,
        name: error.name,
        type: error.type,
      },
    });
    return;
  }

  const { data } = await query.graph({
    entity: 'order',
    fields: req.queryConfig.fields,
    filters: { id: result.id },
  });

  res.status(200).json({
    type: 'order',
    order: data[0],
  });
};
