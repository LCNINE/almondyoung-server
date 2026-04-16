import { useSearchParams } from "react-router-dom"

type QueryParams<T extends string> = {
  [key in T]: string | undefined
}

export function useQueryParams<T extends string>(
  keys: T[],
  prefix?: string,
): QueryParams<T> {
  const [params] = useSearchParams()

  const result = {} as QueryParams<T>

  keys.forEach((key) => {
    const prefixedKey = prefix ? `${prefix}_${key}` : key
    result[key] = params.get(prefixedKey) ?? undefined
  })

  return result
}
