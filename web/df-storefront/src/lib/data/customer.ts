"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeAllAuthTokens,
  setAuthToken,
} from "./cookies"

async function fetchCustomer() {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders || !("authorization" in authHeaders)) {
    return null
  }

  const next = {
    ...(await getCacheOptions("customers")),
  }

  return sdk.client
    .fetch<{ customer: HttpTypes.StoreCustomer }>(`/store/customers/me`, {
      method: "GET",
      query: {
        fields: "*orders",
      },
      headers: authHeaders,
      next,
      cache: "force-cache",
    })
    .then(({ customer }) => customer)
    .catch(() => null)
}

export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    return fetchCustomer()
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

export async function signup(_currentState: unknown, formData: FormData) {
  const countryCode = (formData.get("countryCode") as string) || "kr"
  const redirectTo = (formData.get("redirect_to") as string) || "/"
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const first_name = formData.get("first_name") as string
  const last_name = formData.get("last_name") as string
  const phone = (formData.get("phone") as string) || undefined

  try {
    let registrationToken: string

    try {
      registrationToken = await sdk.auth.register("customer", "emailpass", {
        email,
        password,
      })
    } catch {
      const existingIdentityToken = await sdk.auth.login(
        "customer",
        "emailpass",
        {
          email,
          password,
        }
      )

      if (typeof existingIdentityToken !== "string") {
        throw new Error("Registration requires additional authentication steps")
      }

      registrationToken = existingIdentityToken
    }

    await sdk.store.customer.create(
      {
        email,
        first_name,
        last_name,
        ...(phone ? { phone } : {}),
      },
      {},
      {
        authorization: `Bearer ${registrationToken}`,
      }
    )

    const token = await sdk.auth.login("customer", "emailpass", {
      email,
      password,
    })

    if (typeof token !== "string") {
      throw new Error("Registration requires additional authentication steps")
    }

    await setAuthToken(token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    await transferCart()
  } catch (error: any) {
    return error.message || error.toString()
  }

  redirect(`/${countryCode}${redirectTo}`)
}

export async function login(_currentState: unknown, formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const countryCode = (formData.get("countryCode") as string) || "kr"
  const redirectTo = (formData.get("redirect_to") as string) || "/"

  try {
    const token = await sdk.auth.login("customer", "emailpass", {
      email,
      password,
    })

    if (typeof token !== "string") {
      throw new Error("Login requires additional authentication steps")
    }

    await setAuthToken(token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    await transferCart()
  } catch (error: any) {
    return error.message || error.toString()
  }

  redirect(`/${countryCode}${redirectTo}`)
}

export async function signout(countryCode: string) {
  await sdk.auth.logout().catch(() => {})
  await removeAllAuthTokens()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  redirect(`/${countryCode}/account`)
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
