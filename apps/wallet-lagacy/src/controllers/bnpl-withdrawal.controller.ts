import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    UseGuards,
    Logger,
    HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard, User, Public } from '@app/authorization';
import { ZodValidationPipe } from 'nestjs-zod';

import { BnplWithdrawalService } from '../services/bnpl/bnpl-withdrawal.service';
import {
    RequestWithdrawalDto,
    RequestWithdrawalSchema,
    WithdrawalResponseDto,
    WithdrawalStatusResponseDto,
    WithdrawalErrorResponseDto,
} from './bnpl-withdrawal.controller.zod';
/**
 * BNPL 출금 API 컨트롤러
 *
 * HMS Batch CMS API를 통한 실제 출금(결제) 처리를 담당합니다.
 *
 * **역할 분리:**
 * - `payment.controller.ts`: 나중결제 내부 장부 기록 (BNPL 사용 내역 누적)
 * - `bnpl-withdrawal.controller.ts` (이 파일): 실제 출금 실행 (HMS CMS API 호출)
 *
 * **특징:**
 * - 장부 데이터 없이도 테스트 가능 (직접 금액 지정)
 * - 스케줄러와 낮은 결합도로 설계
 * - 멱등성 보장 (transactionId 기반)
 *
 * @version 1.0
 * @author Wallet Team
 * @since 2025-12-01
 */
@ApiTags('BNPL 출금 (Withdrawal)')
@Controller('/bnpl/withdrawal')
export class BnplWithdrawalController {
    private readonly logger = new Logger(BnplWithdrawalController.name);

    constructor(private readonly withdrawalService: BnplWithdrawalService) { }

    @Post()
    @HttpCode(200)
    @Public() // 테스트용 - 인증 우회
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'BNPL 출금 요청',
        description: `HMS Batch CMS API를 통해 실제 출금(결제)을 요청합니다.

**처리 과정:**
1. 사용자의 BNPL 프로필 조회 (HMS memberId 확인)
2. 고유한 transactionId 생성
3. HMS CMS API 호출하여 출금 요청
4. 결과 반환

**테스트 용이성:**
- 장부 데이터 없이도 테스트 가능
- 요청 시 \`amount\`를 직접 지정
- BNPL 프로필만 있으면 출금 요청 가능

**운영 환경:**
- 스케줄러가 장부 데이터를 기반으로 금액 계산
- 정기적으로 배치 출금 실행

**멱등성:**
- 동일한 transactionId로 재요청 시 안전하게 처리
- HMS API 레벨에서 중복 방지`,
    })
    @ApiBody({
        description: '출금 요청 정보',
        type: RequestWithdrawalDto,
        examples: {
            test: {
                summary: '테스트 출금',
                description: '더미 데이터 없이 직접 금액 지정하여 테스트',
                value: {
                    amount: 50000,
                    paymentDate: '20251210',
                    description: '테스트 출금',
                },
            },
            production: {
                summary: '실제 출금',
                description: '스케줄러가 장부 기반으로 계산한 금액으로 출금',
                value: {
                    amount: 125000,
                    paymentDate: '20251205',
                    description: '12월 정기 결제',
                },
            },
        },
    })
    @ApiResponse({
        status: 200,
        description: '출금 요청 성공',
        type: WithdrawalResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'BNPL 프로필 없음 또는 출금 요청 실패',
        type: WithdrawalErrorResponseDto,
    })
    @ApiResponse({
        status: 401,
        description: '인증 실패',
        type: WithdrawalErrorResponseDto,
    })
    async requestWithdrawal(
        @User('userId') jwtUserId: string,
        @Body(new ZodValidationPipe(RequestWithdrawalSchema)) dto: RequestWithdrawalDto,
    ) {
        try {
            // 테스트용: body에 userId가 있으면 사용, 없으면 JWT에서 추출
            const userId = (dto as any).userId || jwtUserId;

            this.logger.log(`📥 출금 요청 - userId: ${userId}, amount: ${dto.amount}`);

            const result = await this.withdrawalService.requestWithdrawal({
                userId,
                amount: dto.amount,
                paymentDate: dto.paymentDate,
                description: dto.description,
            });

            if (!result.success) {
                this.logger.error(`❌ 출금 요청 실패: ${result.error}`);
                throw new Error(result.error || '출금 요청 실패');
            }

            this.logger.log(`✅ 출금 요청 성공 - transactionId: ${result.transactionId}`);

            return {
                success: true,
                transactionId: result.transactionId,
                memberId: result.memberId,
                amount: result.amount,
                paymentDate: result.paymentDate,
                status: result.status,
                message: result.message,
            };
        } catch (error: any) {
            this.logger.error(`❌ 출금 요청 에러: ${error.message}`, error.stack);
            throw error;
        }
    }

    @Get(':transactionId')
    @Public() // 테스트용 - 인증 우회
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: '출금 상태 조회',
        description: `HMS CMS API를 통해 출금 처리 상태를 조회합니다.

**조회 가능한 정보:**
- 출금 상태 (신청대기, 확인, 완료, 실패 등)
- 요청 금액 및 실제 출금 금액
- 수수료 정보
- 처리 결과 메시지

**상태 값:**
- \`신청대기\`: 출금 요청됨, 처리 대기 중
- \`확인\`: 출금 확인됨
- \`완료\`: 출금 완료
- \`실패\`: 출금 실패`,
    })
    @ApiParam({
        name: 'transactionId',
        description: '출금 거래 ID',
        example: 'bnpl_01HZABC123XYZ',
    })
    @ApiResponse({
        status: 200,
        description: '출금 상태 조회 성공',
        type: WithdrawalStatusResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: '출금 건을 찾을 수 없음',
        type: WithdrawalErrorResponseDto,
    })
    async getWithdrawalStatus(@Param('transactionId') transactionId: string) {
        try {
            this.logger.log(`🔍 출금 상태 조회 - transactionId: ${transactionId}`);

            const result = await this.withdrawalService.getWithdrawalStatus(transactionId);

            this.logger.log(`✅ 출금 상태 조회 성공 - status: ${result.status}`);

            return result;
        } catch (error: any) {
            this.logger.error(`❌ 출금 상태 조회 에러: ${error.message}`, error.stack);
            throw error;
        }
    }

    @Delete(':transactionId')
    @Public() // 테스트용 - 인증 우회
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: '출금 취소',
        description: `아직 처리되지 않은 출금 건을 취소합니다.

**취소 가능 조건:**
- 출금 상태가 \`신청대기\`인 경우
- 아직 실제 출금이 실행되지 않은 경우

**취소 불가 조건:**
- 이미 출금이 완료된 경우
- 출금이 진행 중인 경우

**주의사항:**
- 취소 후에는 복구할 수 없습니다
- 필요 시 새로운 출금 요청을 생성해야 합니다`,
    })
    @ApiParam({
        name: 'transactionId',
        description: '취소할 출금 거래 ID',
        example: 'bnpl_01HZABC123XYZ',
    })
    @ApiResponse({
        status: 200,
        description: '출금 취소 성공',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                transactionId: { type: 'string' },
                message: { type: 'string', example: '출금이 성공적으로 취소되었습니다.' },
            },
        },
    })
    @ApiResponse({
        status: 400,
        description: '취소 불가 상태 (이미 완료됨 등)',
        type: WithdrawalErrorResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: '출금 건을 찾을 수 없음',
        type: WithdrawalErrorResponseDto,
    })
    async cancelWithdrawal(@Param('transactionId') transactionId: string) {
        try {
            this.logger.log(`🗑️ 출금 취소 요청 - transactionId: ${transactionId}`);

            const result = await this.withdrawalService.cancelWithdrawal(transactionId);

            this.logger.log(`✅ 출금 취소 성공 - transactionId: ${transactionId}`);

            return result;
        } catch (error: any) {
            this.logger.error(`❌ 출금 취소 에러: ${error.message}`, error.stack);
            throw error;
        }
    }
}
