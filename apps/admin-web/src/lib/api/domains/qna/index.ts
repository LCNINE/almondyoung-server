'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import {
  QuestionDto,
  QnaListQuery,
  QnaListResponse,
  CreateAnswerDto,
  AnswerDto,
} from '@/lib/types/dto/qna';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

function buildQueryString(query: QnaListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const qnaApi = {
  // 질문 목록 조회 (관리자용 - 비밀글 포함 전체 조회)
  getQuestions: async (query: QnaListQuery): Promise<QnaListResponse> => {
    const qs = buildQueryString(query);
    const response: AxiosResponse<QnaListResponse> = await client.get(
      `${UGC_SERVICE_BASE_URL}/qna/admin/questions${qs ? `?${qs}` : ''}`
    );
    return response.data;
  },

  // 질문 상세 조회 (관리자용 - 비밀글도 조회 가능)
  getQuestion: async (id: string): Promise<QuestionDto> => {
    const response: AxiosResponse<QuestionDto> = await client.get(
      `${UGC_SERVICE_BASE_URL}/qna/admin/questions/${id}`
    );
    return response.data;
  },

  // 답변 작성
  createAnswer: async (
    questionId: string,
    dto: CreateAnswerDto
  ): Promise<AnswerDto> => {
    const response: AxiosResponse<AnswerDto> = await client.post(
      `${UGC_SERVICE_BASE_URL}/qna/questions/${questionId}/answer`,
      dto
    );
    return response.data;
  },

  // 답변 수정
  updateAnswer: async (
    questionId: string,
    dto: CreateAnswerDto
  ): Promise<AnswerDto> => {
    const response: AxiosResponse<AnswerDto> = await client.patch(
      `${UGC_SERVICE_BASE_URL}/qna/questions/${questionId}/answer`,
      dto
    );
    return response.data;
  },

  // 답변 삭제
  deleteAnswer: async (questionId: string): Promise<void> => {
    await client.delete(
      `${UGC_SERVICE_BASE_URL}/qna/questions/${questionId}/answer`
    );
  },

  // 질문 삭제 (관리자, soft delete)
  deleteQuestion: async (questionId: string): Promise<void> => {
    await client.delete(
      `${UGC_SERVICE_BASE_URL}/qna/admin/questions/${questionId}`
    );
  },
};
