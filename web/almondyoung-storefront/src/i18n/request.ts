import { headers } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import {
  countryCodeToLocale,
  extractCountryCodeFromPath,
} from "@/lib/utils/locale-path"

export default getRequestConfig(async () => {
  const headerStore = await headers()
  const pathname = headerStore.get("x-pathname") ?? "/"
  const locale = countryCodeToLocale(extractCountryCodeFromPath(pathname))

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
