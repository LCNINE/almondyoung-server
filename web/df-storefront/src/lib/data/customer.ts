"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import {
  getAccessToken,
  getCookies,
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeAllAuthTokens,
  setTokenCookies,
  setAuthToken,
} from "./cookies"

const MEDUSA_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

const getUsersServiceUrl = () =>
  process.env.USERS_SERVICE_URL ??
  process.env.NEXT_PUBLIC_USERS_SERVICE_URL ??
  "http://localhost:3030"

const getMedusaBackendUrl = () =>
  process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"

async function fetchMedusaSignin(accessToken: string): Promise<string | null> {
  const response = await fetch(`${getMedusaBackendUrl()}/auth/customer/my-auth`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  return data.token ?? data.data?.token ?? null
}

async function fetchMedusaSignup(
  accessToken: string,
  params: {
    email: string
    first_name: string
    last_name: string
    almond_user_id: string
    almond_login_id: string
  }
) {
  const response = await fetch(
    `${getMedusaBackendUrl()}/auth/customer/my-auth/register`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(params),
      cache: "no-store",
    }
  )

  return response.ok
}

async function signInToMedusa(accessToken: string) {
  const medusaToken = await fetchMedusaSignin(accessToken)

  if (!medusaToken) {
    return false
  }

  await setAuthToken(medusaToken)

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await transferCart()

  return true
}

async function restoreUserServiceAccessToken(): Promise<string | null> {
  const response = await fetch(`${getUsersServiceUrl()}/auth/restore-token`, {
    method: "POST",
    headers: {
      Cookie: await getCookies(),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }

  const result = await response.json().catch(() => ({}))
  const accessToken = result.data?.accessToken ?? result.accessToken ?? null

  if (!accessToken) {
    return null
  }

  await setTokenCookies(accessToken)

  return accessToken
}

async function ensureMedusaAuthToken(): Promise<boolean> {
  let accessToken = await getAccessToken()

  if (!accessToken) {
    accessToken = await restoreUserServiceAccessToken()
  }

  if (!accessToken) {
    return false
  }

  return signInToMedusa(accessToken)
}

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

async function callbackSignup(userId: string) {
  const response = await fetch(`${getUsersServiceUrl()}/auth/callback/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
    cache: "no-store",
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || "Signup callback failed")
  }

  return result.data ?? result
}

async function signInToUserService(
  loginId: string,
  password: string,
  rememberMe = false
) {
  const response = await fetch(`${getUsersServiceUrl()}/auth/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ loginId, password, rememberMe }),
    cache: "no-store",
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || "Login failed")
  }

  return result.data ?? result
}

async function signUpToUserService(payload: {
  email: string
  username: string
  nickname: string
  loginId: string
  password: string
  birthday: string
  phoneNumber: string
  isOver14: boolean
  termsOfService: boolean
  electronicTransaction: boolean
  privacyPolicy: boolean
  thirdPartySharing: boolean
  marketingConsent: boolean
}) {
  const response = await fetch(`${getUsersServiceUrl()}/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || "Signup failed")
  }

  return result.data ?? result
}

export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    const customer = await fetchCustomer()

    if (customer) {
      return customer
    }

    const restored = await ensureMedusaAuthToken()

    if (!restored) {
      return null
    }

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
  const loginId = formData.get("loginId") as string
  const password = formData.get("password") as string
  const email = formData.get("email") as string
  const username = formData.get("username") as string
  const nickname = formData.get("nickname") as string
  const birthday = formData.get("birthday") as string
  const phoneNumber = formData.get("phoneNumber") as string

  const signupPayload = {
    email,
    username,
    nickname,
    loginId,
    password,
    birthday,
    phoneNumber,
    isOver14: formData.get("isOver14") === "on",
    termsOfService: formData.get("termsOfService") === "on",
    electronicTransaction: formData.get("electronicTransaction") === "on",
    privacyPolicy: formData.get("privacyPolicy") === "on",
    thirdPartySharing: formData.get("thirdPartySharing") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
  }

  try {
    const signupResult = await signUpToUserService(signupPayload)
    const tokens = await callbackSignup(signupResult.userId)

    await setTokenCookies(tokens.accessToken, tokens.refreshToken)

    const medusaSigninToken = await fetchMedusaSignin(tokens.accessToken)

    if (!medusaSigninToken) {
      const signupOk = await fetchMedusaSignup(tokens.accessToken, {
        email,
        first_name: username,
        last_name: username,
        almond_user_id: signupResult.userId,
        almond_login_id: loginId,
      })

      if (!signupOk) {
        throw new Error("Failed to create Medusa customer")
      }
    }

    const signedIn = await signInToMedusa(tokens.accessToken)

    if (!signedIn) {
      throw new Error("Failed to issue Medusa token")
    }
  } catch (error: any) {
    return error.message || error.toString()
  }

  redirect(`/${countryCode}${redirectTo}`)
}

export async function login(_currentState: unknown, formData: FormData) {
  const loginId = formData.get("loginId") as string
  const password = formData.get("password") as string
  const countryCode = (formData.get("countryCode") as string) || "kr"
  const redirectTo = (formData.get("redirect_to") as string) || "/"
  const rememberMe = formData.get("rememberMe") === "on"

  try {
    const tokens = await signInToUserService(loginId, password, rememberMe)
    await setTokenCookies(tokens.accessToken, tokens.refreshToken)

    const signedIn = await signInToMedusa(tokens.accessToken)

    if (!signedIn) {
      throw new Error("Failed to issue Medusa token")
    }
  } catch (error: any) {
    return error.message || error.toString()
  }

  redirect(`/${countryCode}${redirectTo}`)
}

export async function signout(countryCode: string) {
  try {
    await fetch(`${getUsersServiceUrl()}/auth/signout`, {
      method: "POST",
      headers: {
        Cookie: await getCookies(),
      },
      cache: "no-store",
    })
  } catch {}

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
