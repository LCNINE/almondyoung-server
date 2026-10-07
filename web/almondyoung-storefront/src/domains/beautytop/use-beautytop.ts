"use client"

import { queryBeautyTop, type BeautyTopQuery } from "@/lib/beautytop/client"
import { useQuery } from "@tanstack/react-query"

export function useBeautyTop<T>(query: BeautyTopQuery, enabled = true) {
  return useQuery({
    queryKey: ["beautytop", query],
    queryFn: ({ signal }) =>
      queryBeautyTop<T>(query, signal).then((result) => result.data),
    retry: false,
    enabled,
  })
}
