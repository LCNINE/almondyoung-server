import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateTemplateDto, KakaoTemplateConfig, FCMConfig, EmailConfig, SMSConfig } from './create-template.dto';

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {
    // 채널별 고급 설정도 업데이트 가능하도록 확장
    @ApiPropertyOptional({
        type: FCMConfig,
        description: 'FCM 설정 업데이트'
    })
    fcmConfig?: FCMConfig;

    @ApiPropertyOptional({
        type: EmailConfig,
        description: '이메일 설정 업데이트'
    })
    emailConfig?: EmailConfig;

    @ApiPropertyOptional({
        type: SMSConfig,
        description: 'SMS 설정 업데이트'
    })
    smsConfig?: SMSConfig;

    @ApiPropertyOptional({
        type: KakaoTemplateConfig,
        description: '카카오 템플릿 설정 업데이트'
    })
    kakaoTemplateConfig?: KakaoTemplateConfig;
}
