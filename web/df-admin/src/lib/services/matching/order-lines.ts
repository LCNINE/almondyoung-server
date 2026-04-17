import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { orderLinesApi } from "@/lib/api/matching/order-lines"
import type {
  MatchingPriority,
  MatchingStrategy,
  OrderLineQuery,
  ResolveMatchingDto,
  StockPolicyDto,
} from "@/lib/types/matching"
import { matchingKeys } from "./query-keys"

export function useOrderLines(query: OrderLineQuery) {
  return useQuery({
    queryKey: matchingKeys.orderLines.list(query),
    queryFn: () => orderLinesApi.list(query),
    placeholderData: (prev) => prev,
  })
}

export function useResolveMatching() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      matchingId,
      dto,
    }: {
      matchingId: string
      dto: ResolveMatchingDto
    }) => orderLinesApi.resolve(matchingId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matchingKeys.orderLines.all })
      qc.invalidateQueries({ queryKey: matchingKeys.variant.all })
      qc.invalidateQueries({ queryKey: matchingKeys.masters.all })
    },
  })
}

export function useSetMatchingPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      matchingId,
      priority,
    }: {
      matchingId: string
      priority: MatchingPriority
    }) => orderLinesApi.setPriority(matchingId, priority),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matchingKeys.orderLines.all })
    },
  })
}

export function useChangeMatchingStrategy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      matchingId,
      strategy,
    }: {
      matchingId: string
      strategy: MatchingStrategy
    }) => orderLinesApi.changeStrategy(matchingId, strategy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matchingKeys.orderLines.all })
    },
  })
}

export function useUpdateStockPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      matchingId,
      policy,
    }: {
      matchingId: string
      policy: StockPolicyDto
    }) => orderLinesApi.updateStockPolicy(matchingId, policy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matchingKeys.orderLines.all })
      qc.invalidateQueries({ queryKey: matchingKeys.variant.all })
    },
  })
}
