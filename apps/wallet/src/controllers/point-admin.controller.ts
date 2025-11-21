import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PointService } from '../services/points/point.service';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

// DTO
class GrantPointsDto {
    @IsString()
    @IsNotEmpty()
    partnerId: string;

    @IsInt()
    @Min(1)
    amount: number;

    @IsString()
    @IsNotEmpty()
    reason: string;

    @IsString()
    @IsOptional()
    memo?: string;
}

@ApiTags('Admin Points')
@Controller('admin/points')
export class PointAdminController {
    constructor(private readonly pointService: PointService) { }

    @Post('grant')
    @ApiOperation({ summary: '관리자 포인트 수동 지급' })
    async grantPoints(@Body() body: GrantPointsDto) {
        // TODO: 실제 운영 환경에서는 Admin Auth Guard가 필요함
        // 현재는 데모/개발 편의를 위해 생략하거나 기본 Guard만 적용

        await this.pointService.grantByAdmin({
            partnerId: body.partnerId,
            amount: body.amount,
            reason: body.reason,
            memo: body.memo,
        });

        return { success: true };
    }
}
