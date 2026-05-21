"use server"

import { sdk } from "@/lib/config/medusa"
import { StoreCustomerWithGroupsResDto } from "@/lib/types/dto/medusa"
import medusaError from "@lib/utils/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  setCartId,
} from "../../data/cookies"
import { handleMedusaAuthError } from "./auth-utils"

export const retrieveCustomer =
  async (): Promise<StoreCustomerWithGroupsResDto | null> => {
    const authHeaders = await getAuthHeaders()

    if (!authHeaders) return null

    const headers = {
      ...authHeaders,
    }

    return await sdk.client
      .fetch<{ customer: StoreCustomerWithGroupsResDto }>(
        `/store/customers/me`,
        {
          method: "GET",
          // groups 필드는 백엔드에서 기본적으로 넣어주기 때문에 따로 요청하면안됌
          // query: { fields: "*groups" },
          headers,
          cache: "no-store",
        }
      )
      .then(({ customer }) => customer)
      .catch(() => null)
  }

export const getCustomerAddresses = async (): Promise<
  HttpTypes.StoreCustomerAddress[] | null
> => {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders) return null

  const headers = {
    ...authHeaders,
  }

  return await sdk.store.customer
    .listAddress({}, headers)
    .then(({ addresses }) => addresses)
    .catch(async (error) => {
      await handleMedusaAuthError(error)
      console.error("getCustomerAddresses error:", error)
      return null
    })
}

export const updateCustomer = async (body: HttpTypes.StoreUpdateCustomer) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const updateRes = await sdk.store.customer
    .update(body, {}, headers)
    .then(({ customer }) => customer)
    .catch(medusaError)

  const cacheTag = await getCacheTag("customers")
  revalidateTag(cacheTag)

  return updateRes
}

export async function transferCart() {
  const cartId = await getCartId()

  if (!cartId) {
    return
  }

  const headers = await getAuthHeaders()

  await sdk.store.cart.transferCart(cartId, {}, { ...headers })

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
}

export async function recoverCustomerCart(): Promise<HttpTypes.StoreCart | null> {
  const headers = {
    ...(await getAuthHeaders()),
  }

  if (!headers.authorization) {
    return null
  }

  const cart = await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart | null }>(`/store/customers/me/cart`, {
      method: "GET",
      headers,
      cache: "no-store",
    })
    .then(({ cart }) => cart)
    .catch((error) => {
      console.error("recoverCustomerCart error:", error)
      return null
    })

  if (!cart?.id) {
    return null
  }

  await setCartId(cart.id)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  return cart
}

export const addCustomerAddress = async (
  currentState: Record<string, unknown>,
  formData: FormData
): Promise<any> => {
  const isDefaultBilling = (currentState.isDefaultBilling as boolean) || false
  const isDefaultShipping = (currentState.isDefaultShipping as boolean) || false

  const address = {
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    company: formData.get("company") as string,
    address_1: formData.get("address_1") as string,
    address_2: formData.get("address_2") as string,
    city: formData.get("city") as string,
    postal_code: formData.get("postal_code") as string,
    province: formData.get("province") as string,
    country_code: formData.get("country_code") as string,
    phone: formData.get("phone") as string,
    is_default_billing: isDefaultBilling,
    is_default_shipping: isDefaultShipping,
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .createAddress(address, {}, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

export const createCustomerShippingAddress = async (
  address: HttpTypes.StoreCreateCustomerAddress
): Promise<{ success: boolean; error: string | null }> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return await sdk.store.customer
    .createAddress(
      {
        ...address,
        is_default_shipping: address.is_default_shipping ?? true,
      },
      {},
      headers
    )
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

export const deleteCustomerAddress = async (
  addressId: string
): Promise<{ success: boolean; error: string | null }> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .deleteAddress(addressId, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

/**
 * 고객 주문 목록 조회
 */
export const getCustomerOrders = async (params?: {
  limit?: number
  offset?: number
}): Promise<{ orders: HttpTypes.StoreOrder[]; count: number } | null> => {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders) return null

  const headers = {
    ...authHeaders,
  }

  try {
    const response = await sdk.store.order.list(
      {
        limit: params?.limit ?? 10,
        offset: params?.offset ?? 0,
        fields:
          "*items,*items.variant,*items.variant.product,*shipping_address,*billing_address",
      },
      headers
    )

    return {
      orders: response.orders,
      count: response.count ?? 0,
    }
  } catch (error) {
    console.error("주문 목록 조회 실패:", error)
    return null
  }
}

export const setDefaultShippingAddress = async (
  addressId: string
): Promise<{ success: boolean; error: string | null }> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .updateAddress(addressId, { is_default_shipping: true }, {}, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

export const updateCustomerShippingAddress = async (
  addressId: string,
  address: HttpTypes.StoreUpdateCustomerAddress
): Promise<{ success: boolean; error: string | null }> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .updateAddress(addressId, address, {}, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}
