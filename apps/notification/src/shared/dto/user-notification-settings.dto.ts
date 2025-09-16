import { IsBoolean, IsOptional, IsString, IsObject } from 'class-validator';

export class UpdateUserNotificationSettingsDto {
    @IsBoolean()
    @IsOptional()
    isMarketingEnabled?: boolean;

    @IsString()
    @IsOptional()
    preferredLanguage?: 'ko' | 'en';

    @IsObject()
    @IsOptional()
    pushSettings?: {
        sound?: boolean;
        vibration?: boolean;
        showPreview?: boolean;
        quietHours?: {
            enabled: boolean;
            startTime?: string;
            endTime?: string;
        };
    };

    @IsObject()
    @IsOptional()
    settings?: Record<string, any>;
}

export class CreateUserNotificationSettingsDto extends UpdateUserNotificationSettingsDto {
    @IsBoolean()
    isMarketingEnabled: boolean;

    @IsString()
    preferredLanguage: 'ko' | 'en';
}
