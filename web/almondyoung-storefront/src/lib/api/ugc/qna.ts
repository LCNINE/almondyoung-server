"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import {
  QuestionResponseDto,
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionListQueryDto,
  CreateAnswerDto,
  AnswerResponseDto,
} from "@/lib/types/dto/ugc"
import { getAccessToken, getCookies } from "@/lib/data/cookies"

const UGC_BASE_URL = "http://localhost:8090"

const getAuthHeaders = async () => {
  const accessToken = await getAccessToken()
  const cookieString = await getCookies()

  if (!accessToken) {
    throw new Error("인증이 필요합니다")
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: cookieString,
  }
}

// ─── 질문 ───

/**
 * 상품별 질문 목록 조회 (공개 API)
 */
export const getQuestionsByProductId = async ({
  productId,
  sort,
  page,
  limit,
}: QuestionListQueryDto): Promise<
  PaginatedResponseDto<QuestionResponseDto>
> => {
  const params: Record<string, string> = {
    productId,
  }

  if (sort) params.sort = sort
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  const queryString = new URLSearchParams(params).toString()

  // todo: 임시 - 로컬 직접 호출
  const result = await fetch(`${UGC_BASE_URL}/qna/questions?${queryString}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })

  const data = await result.json()

  return data
}

/**
 * 질문 상세 조회 (공개 API)
 */
export const getQuestion = async (
  id: string
): Promise<QuestionResponseDto> => {
  const result = await fetch(`${UGC_BASE_URL}/qna/questions/${id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })

  const data = await result.json()

  return data
}

/**
 * 질문 작성 (인증 필요)
 */
export const createQuestion = async (
  dto: CreateQuestionDto
): Promise<QuestionResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/qna/questions`, {
    method: "POST",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 질문 수정 (인증 필요, 본인만)
 */
export const updateQuestion = async (
  id: string,
  dto: UpdateQuestionDto
): Promise<QuestionResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/qna/questions/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 질문 삭제 (인증 필요, 본인만, soft delete)
 */
export const deleteQuestion = async (id: string): Promise<void> => {
  const headers = await getAuthHeaders()

  await fetch(`${UGC_BASE_URL}/qna/questions/${id}`, {
    method: "DELETE",
    headers,
  })
}

// ─── 답변 (관리자) ───

/**
 * 답변 작성 (관리자 인증 필요)
 */
export const createAnswer = async (
  questionId: string,
  dto: CreateAnswerDto
): Promise<AnswerResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(
    `${UGC_BASE_URL}/qna/questions/${questionId}/answer`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(dto),
    }
  )

  const data = await result.json()

  return data
}

/**
 * 답변 수정 (관리자 인증 필요)
 */
export const updateAnswer = async (
  questionId: string,
  dto: CreateAnswerDto
): Promise<AnswerResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(
    `${UGC_BASE_URL}/qna/questions/${questionId}/answer`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(dto),
    }
  )

  const data = await result.json()

  return data
}

/**
 * 답변 삭제 (관리자 인증 필요)
 */
export const deleteAnswer = async (questionId: string): Promise<void> => {
  const headers = await getAuthHeaders()

  await fetch(`${UGC_BASE_URL}/qna/questions/${questionId}/answer`, {
    method: "DELETE",
    headers,
  })
}
