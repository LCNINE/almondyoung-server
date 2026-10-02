"use client"

import { useQuery } from "@tanstack/react-query"

type AreaResource = "options" | "market" | "lifecycle" | "trends" | "prices" | "revenue"

// Neighbourhood aggregates come from our server cache, for members too: viewing them
// must not mint a member token (that would count as opening the premium benefit).
export function useArea<T>(resource: AreaResource, params: Record<string, string> = {}, enabled = true) {
  return useQuery({
    queryKey: ["beautytop-area", resource, params],
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({ resource, ...params })
      const response = await fetch(`/api/beautytop/area?${search}`, { signal, credentials: "omit" })
      if (!response.ok) throw new Error(`area ${response.status}`)
      return ((await response.json()) as { data: T }).data
    },
    staleTime: 5 * 60_000,
    retry: 1,
    enabled,
  })
}
