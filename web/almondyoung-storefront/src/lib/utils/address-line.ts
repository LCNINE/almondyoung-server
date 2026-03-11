interface AddressLineParams {
  province?: string | null
  city?: string | null
  address1?: string | null
  address2?: string | null
}

const normalize = (value?: string | null): string =>
  (value ?? "").replace(/\s+/g, " ").trim()

const stripLeadingPrefix = (source: string, prefix: string): string => {
  if (!prefix) return source
  if (source === prefix) return ""
  if (source.startsWith(`${prefix} `)) {
    return source.slice(prefix.length + 1).trim()
  }

  return source
}

export const buildAddressLine = ({
  province,
  city,
  address1,
  address2,
}: AddressLineParams): string => {
  const normalizedProvince = normalize(province)
  const normalizedCity = normalize(city)
  const normalizedAddress1 = normalize(address1)
  const normalizedAddress2 = normalize(address2)

  const address1WithoutDup = stripLeadingPrefix(
    normalizedAddress1,
    [normalizedProvince, normalizedCity].filter(Boolean).join(" ")
  )

  return [
    normalizedProvince,
    normalizedCity,
    address1WithoutDup || normalizedAddress1,
    normalizedAddress2,
  ]
    .filter(Boolean)
    .join(" ")
}
