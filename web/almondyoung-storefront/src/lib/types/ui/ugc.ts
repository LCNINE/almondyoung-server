import type {
  ReviewResponseDto,
  RatingSummaryResponseDto,
  RewardPolicyResponseDto,
  CommentResponseDto,
  ToggleReactionResponseDto,
  ReviewEligibilityResponseDto,
  QuestionResponseDto,
  AnswerResponseDto,
  QnaSummaryResponseDto,
} from "@/lib/types/dto/ugc"

// ─── Reviews ───

interface ReviewDetail extends ReviewResponseDto {}

interface RatingSummary extends RatingSummaryResponseDto {}

interface RewardPolicy extends RewardPolicyResponseDto {}

interface ReviewComment extends CommentResponseDto {}

interface ToggleReactionResult extends ToggleReactionResponseDto {}

interface ReviewEligibility extends ReviewEligibilityResponseDto {}

// ─── Q&A ───

interface Question extends QuestionResponseDto {}

interface Answer extends AnswerResponseDto {}

interface QnaSummary extends QnaSummaryResponseDto {}

export type {
  ReviewDetail,
  RatingSummary,
  RewardPolicy,
  ReviewComment,
  ToggleReactionResult,
  ReviewEligibility,
  Question,
  Answer,
  QnaSummary,
}
