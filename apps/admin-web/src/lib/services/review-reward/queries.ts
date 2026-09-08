'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { reviewRewardApi } from '@/lib/api/domains/review-reward';
import { BestSelectionStatus, ReviewRewardGrantStatus } from '@/lib/types/dto/review-reward';
import { reviewRewardQueryKeys } from './query-keys';

export const useReviewRewardRules = () =>
  useQuery({
    queryKey: reviewRewardQueryKeys.rules(),
    queryFn: () => reviewRewardApi.getRules(),
    staleTime: 30 * 1000,
  });

export const useReviewRewardGrants = (query: { page: number; limit: number; status?: ReviewRewardGrantStatus }) =>
  useQuery({
    queryKey: reviewRewardQueryKeys.grants(query),
    queryFn: () => reviewRewardApi.getGrants(query),
    placeholderData: keepPreviousData,
  });

export const useReviewRewardSummary = (days: number) =>
  useQuery({
    queryKey: reviewRewardQueryKeys.summary(days),
    queryFn: () => reviewRewardApi.getSummary(days),
    staleTime: 60 * 1000,
  });

export const useBestSelections = (query: { status?: BestSelectionStatus; page: number; limit: number }) =>
  useQuery({
    queryKey: reviewRewardQueryKeys.bestSelections(query),
    queryFn: () => reviewRewardApi.getBestSelections(query),
    placeholderData: keepPreviousData,
  });
