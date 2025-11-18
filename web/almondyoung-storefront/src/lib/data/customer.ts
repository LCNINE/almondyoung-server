"use server"

import { serverApi } from "@lib/api/server-api"
import { sdk } from "@lib/app-config"
import medusaError from "@lib/utils/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { MEDUSA_BASE_URL, USER_SERVICE_BASE_URL } from "../api/api.config"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeAccessToken,
  removeCartId,
  removeMedusaAuthToken,
  removeRefreshToken,
  setMedusaAuthToken,
} from "./cookies"

type MedusaSignupRequest = {
  email: string
  first_name: string
  last_name: string
  almond_user_id: string
  almond_login_id: string
}

type MedusaSignupResponse = {
  authIdentity: {
    id: string
  }
  customer: {
    id: string
  }
}

export const medusaSignup = async (
  data: MedusaSignupRequest
): Promise<MedusaSignupResponse> => {
  const res = await fetch(`${MEDUSA_BASE_URL}/auth/customer/my-auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
      almond_user_id: data.almond_user_id,
      almond_login_id: data.almond_login_id,
    }),
  })

  const result = await res.json()

  return result
}

// 메두사 jwt 토큰 발급
export const customerAuthCallback = async (almondToken: string) => {
  const res = await fetch(`${MEDUSA_BASE_URL}/api/auth/medusa/callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${almondToken}`,
    },
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.message || `HTTP error! status: ${res.status}`)
  }

  const result = await res.json()

  return result
}

export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    // Mock 환경에서는 로그인 상태 확인 후 mock 사용자 데이터 반환
    const authHeaders = await getAuthHeaders()

    if (!authHeaders) return null

    const headers = {
      ...authHeaders,
    }

    const next = {
      ...(await getCacheOptions("customers")),
    }

    return await sdk.client
      .fetch<{ customer: HttpTypes.StoreCustomer }>(`/store/customers/me`, {
        method: "GET",
        query: {
          fields: "*orders",
        },
        headers,
        next,
        cache: "force-cache",
      })
      .then(({ customer }) => customer)
      .catch(() => null)
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

export async function medusaLogin(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const headers = {
      ...(await getAuthHeaders("accessToken")),
    }

    const res = await fetch(`${MEDUSA_BASE_URL}/auth/customer/my-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    })

    const result = await res.json()

    if (!res.ok) {
      return { success: false, error: result.error }
    }

    await setMedusaAuthToken(result.token as string)
    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)
  } catch (error: any) {
    console.log("error:", error)
    return error.toString()
  }

  try {
    await transferCart()

    return { success: true }
  } catch (error: any) {
    return error.toString()
  }
}

export async function signout() {
  await serverApi(USER_SERVICE_BASE_URL + "/auth/signout", {
    method: "POST",
    body: JSON.stringify({}),
  })

  await sdk.auth.logout()

  await removeMedusaAuthToken()
  await removeAccessToken()
  await removeRefreshToken()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await removeCartId()

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
  redirect("/")
}

export async function transferCart() {
  const cartId = await getCartId()

  if (!cartId) {
    return
  }

  const headers = await getAuthHeaders()

  await sdk.store.cart.transferCart(cartId, {}, headers)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
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
    .then(async ({ customer }) => {
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
): Promise<void> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.customer
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

export const updateCustomerAddress = async (
  currentState: Record<string, unknown>,
  formData: FormData
): Promise<any> => {
  const addressId =
    (currentState.addressId as string) || (formData.get("addressId") as string)

  if (!addressId) {
    return { success: false, error: "Address ID is required" }
  }

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
  } as HttpTypes.StoreUpdateCustomerAddress

  const phone = formData.get("phone") as string

  if (phone) {
    address.phone = phone
  }

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
