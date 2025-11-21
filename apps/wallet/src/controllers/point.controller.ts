import {
    Controller,
    Get,
    Query,
    UseGuards,
    Logger,
    DefaultValuePipe,
    ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../libs/auth-core/src/guards/jwt-auth.guard';
import { User } from '../../../../libs/auth-core/src/decorators/user.decorator';
import { PointService } from '../services/points/point.service';

@ApiTags('포인트 (Points)')
@Controller('/payments/points')
export class PointController {
    private readonly logger = new Logger(PointController.name);

    constructor(private readonly pointService: PointService) { }

    @Get('history')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: '포인트 내역 조회',
        description: '사용자의 포인트 적립/사용 내역을 조회합니다.',
    })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: '조회할 내역 수 (기본값: 20)',
    })
    @ApiQuery({
        name: 'offset',
        required: false,
        description: '건너뛸 내역 수 (기본값: 0)',
    })
    @ApiResponse({
        status: 200,
        description: '포인트 내역 조회 성공',
        schema: {
            example: {
                items: [
                    {
                        id: 123,
                        eventType: 'EARN',
                        amount: 1000,
                        balance: 5000,
                        reason: '상품 구매 적립',
                        createdAt: '2024-05-20T10:00:00Z',
                    },
                ],
                total: 1,
            },
        },
    })
    async getHistory(
        @User('userId') userId: string,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    ) {
        // partnerId는 userId와 동일하게 취급 (스키마 주석 참고: partnerId == customerId == userId)
        const partnerId = userId;

        this.logger.log(`포인트 내역 조회: user=${userId}, limit=${limit}, offset=${offset}`);

        const { items, total } = await this.pointService.getHistory(
            partnerId,
            limit,
            offset,
        );

        return {
            items,
            total,
        };
    }

    @Get('balance')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: '포인트 잔액 조회',
        description: '사용자의 현재 포인트 잔액을 조회합니다.',
    })
    async getBalance(@User('userId') userId: string) {
        const partnerId = userId;
        const balance = await this.pointService.getBalance(partnerId);
        const withdrawable = await this.pointService.getWithdrawable(partnerId);

        return {
            balance,
            withdrawable,
        };
    }
}
