import { PartialType } from '@nestjs/swagger';
import { CreateTemplateDto, KakaoTemplateConfig, FCMConfig, EmailConfig, SMSConfig } from './create-template.dto';

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {
    // 채널별 고급 설정도 업데이트 가능하도록 확장
    fcmConfig?: FCMConfig;
    emailConfig?: EmailConfig;
    smsConfig?: SMSConfig;
    kakaoTemplateConfig?: KakaoTemplateConfig;
}
