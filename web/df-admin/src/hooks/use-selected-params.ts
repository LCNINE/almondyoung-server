import { useLocation, useNavigate, useSearchParams } from "react-router-dom"

type UseSelectedParamsOptions = {
  prefix?: string
}

export function useSelectedParams({ prefix }: UseSelectedParamsOptions = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const prefixKey = (key: string) => (prefix ? `${prefix}_${key}` : key)

  const get = (key: string): string | string[] | undefined => {
    const value = searchParams.get(prefixKey(key))
    if (value === null) return undefined
    if (value.includes(",")) return value.split(",")
    return value
  }

  const replaceParams = (params: URLSearchParams) => {
    const qs = params.toString()
    navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true })
  }

  const add = (key: string, value: string | string[]) => {
    const params = new URLSearchParams(searchParams.toString())
    const strValue = Array.isArray(value) ? value.join(",") : value
    params.set(prefixKey(key), strValue)
    params.delete(prefixKey("page"))
    replaceParams(params)
  }

  const deleteParam = (key: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete(prefixKey(key))
    params.delete(prefixKey("page"))
    replaceParams(params)
  }

  const deleteMany = (keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of keys) {
      params.delete(prefixKey(key))
    }
    params.delete(prefixKey("page"))
    replaceParams(params)
  }

  return { get, add, delete: deleteParam, deleteMany, searchParams }
}
