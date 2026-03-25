"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import {
  QuestionResponseDto,
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionListQueryDto,
  MyQuestionListQueryDto,
  CreateAnswerDto,
  AnswerResponseDto,
  QnaSummaryResponseDto,
} from "@/lib/types/dto/ugc"
import { api } from "../api"
import { getAccessToken } from "@/lib/data/cookies"

// ─── 질문 ───

/**
 * 질문 목록 조회 (상품별 또는 전체)
 * 로그인 시 본인 비밀글은 내용이 보임
 */
export const getQuestionsByProductId = async ({
  productId,
  category,
  sort,
  page,
  limit,
}: QuestionListQueryDto): Promise<
  PaginatedResponseDto<QuestionResponseDto>
> => {
  const params: Record<string, string> = {}

  if (productId) params.productId = productId
  if (category) params.category = category
  if (sort) params.sort = sort
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  const queryString = new URLSearchParams(params).toString()

  // 토큰이 있으면 인증 포함 (본인 비밀글 확인 가능)
  const accessToken = await getAccessToken()

  return await api(
    "ugc",
    `/qna/questions${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      withAuth: !!accessToken,
    }
  )
}

/**
 * 내 문의 목록 조회
 */
export const getMyQuestions = async ({
  category,
  sort,
  page,
  limit,
}: MyQuestionListQueryDto = {}): Promise<
  PaginatedResponseDto<QuestionResponseDto>
> => {
  const params: Record<string, string> = {}

  if (category) params.category = category
  if (sort) params.sort = sort
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  const queryString = new URLSearchParams(params).toString()

  return await api(
    "ugc",
    `/qna/questions/me${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      withAuth: true,
    }
  )
}

/**
 * 상품별 Q&A 요약 조회
 */
export const getQnaSummary = async (
  productId: string
): Promise<QnaSummaryResponseDto> => {
  return await api("ugc", `/qna/questions/summary`, {
    method: "GET",
    params: { productId },
    withAuth: false,
  })
}

/**
 * 질문 상세 조회
 */
export const getQuestionById = async (
  id: string
): Promise<QuestionResponseDto> => {
  return await api("ugc", `/qna/questions/${id}`, {
    method: "GET",
    withAuth: false,
  })
}

/**
 * 질문 작성
 */
export const createQuestion = async (
  dto: CreateQuestionDto
): Promise<QuestionResponseDto> => {
  return await api("ugc", `/qna/questions`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 질문 수정
 */
export const updateQuestion = async (
  id: string,
  dto: UpdateQuestionDto
): Promise<QuestionResponseDto> => {
  return await api("ugc", `/qna/questions/${id}`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
}

/**
 * 질문 삭제
 */
export const deleteQuestion = async (id: string): Promise<void> => {
  return await api("ugc", `/qna/questions/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
}

// ─── 답변 (관리자) ───

/**
 * 답변 작성
 */
export const createAnswer = async (
  questionId: string,
  dto: CreateAnswerDto
): Promise<AnswerResponseDto> => {
  return await api("ugc", `/qna/questions/${questionId}/answer`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 답변 수정
 */
export const updateAnswer = async (
  questionId: string,
  dto: CreateAnswerDto
): Promise<AnswerResponseDto> => {
  return await api("ugc", `/qna/questions/${questionId}/answer`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
}

/**
 * 답변 삭제
 */
export const deleteAnswer = async (questionId: string): Promise<void> => {
  return await api("ugc", `/qna/questions/${questionId}/answer`, {
    method: "DELETE",
    withAuth: true,
  })
}
