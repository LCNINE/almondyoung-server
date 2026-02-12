import {
  MedusaRequest,
  MedusaResponse,
  prepareRetrieveQuery,
} from "@medusajs/framework/http"
import { deleteLineItemsWorkflow } from "@medusajs/medusa/core-flows"
import { refetchCart } from "../../../helpers"
import { defaultStoreCartFields } from "../../../query-config"

type BatchDeleteLineItemsBody = {
  ids: string[]
}

/**
 * 여러 line item을 한 번에 삭제하는 API
 * POST /store/carts/:id/line-items/batch
 * Body: { ids: string[] }
 */
export const POST = async (
  req: MedusaRequest<BatchDeleteLineItemsBody>,
  res: MedusaResponse
) => {
  const cartId = req.params.id
  const { ids } = req.body

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({
      message: "ids 배열이 필요합니다",
    })
    return
  }

  await deleteLineItemsWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      ids,
    },
  })

  const cart = await refetchCart(
    cartId,
    req.scope,
    prepareRetrieveQuery(
      {},
      {
        defaults: defaultStoreCartFields,
      }
    ).remoteQueryConfig.fields
  )

  res.status(200).json({
    cart,
    deleted_count: ids.length,
  })
}
