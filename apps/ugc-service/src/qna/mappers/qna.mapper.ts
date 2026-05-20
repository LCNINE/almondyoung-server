import { AnswerResponseDto } from '../dto/answer-response.dto';
import { QuestionResponseDto } from '../dto/question-response.dto';
import { type AnswerEntity, type QuestionWithDetailsEntity } from '../types';

export class QnaMapper {
  static toQuestionResponse(
    entity: QuestionWithDetailsEntity,
    options?: { hideSecret?: boolean },
  ): QuestionResponseDto {
    const isHidden = options?.hideSecret && entity.isSecret;

    return {
      id: entity.id,
      userId: entity.userId,
      nickname: isHidden ? '' : entity.nickname,
      productId: entity.productId ?? null,
      category: entity.category ?? null,
      subCategory: entity.subCategory ?? null,
      title: isHidden ? '비밀글입니다.' : entity.title,
      content: isHidden ? '' : entity.content,
      isSecret: entity.isSecret,
      status: entity.status,
      deletedAt: entity.deletedAt?.toISOString() ?? null,
      mediaFileIds: isHidden ? [] : entity.mediaFileIds,
      answer: entity.answer ? QnaMapper.toAnswerResponse(entity.answer) : null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  static toAnswerResponse(entity: AnswerEntity): AnswerResponseDto {
    return {
      id: entity.id,
      questionId: entity.questionId,
      adminUserId: entity.adminUserId,
      content: entity.content,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
