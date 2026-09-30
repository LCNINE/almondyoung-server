import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const ALIMTALK_MEMBER_AUDIENCES = ['NONE', 'ALL', 'MEMBERSHIP'] as const;
export type AlimtalkMemberAudience = (typeof ALIMTALK_MEMBER_AUDIENCES)[number];

export class VariableBindingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: ['RECIPIENT_NAME', 'FIXED'], description: '받는 사람 이름으로 채우거나, 모두에게 같은 값' })
  @IsIn(['RECIPIENT_NAME', 'FIXED'])
  source: 'RECIPIENT_NAME' | 'FIXED';

  @ApiPropertyOptional()
  @ValidateIf((o: VariableBindingDto) => o.source === 'FIXED')
  @IsString()
  @MaxLength(500)
  value?: string;
}

export class ManualRecipientDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class PreviewAlimtalkCampaignDto {
  @ApiProperty()
  @Matches(/^[A-Za-z0-9_]{1,20}$/)
  templateCode: string;

  @ApiProperty({
    enum: ALIMTALK_MEMBER_AUDIENCES,
    description: '회원 넣지 않음 / 휴대폰 번호가 있는 회원 전체 / 멤버십 회원만',
  })
  @IsIn(ALIMTALK_MEMBER_AUDIENCES)
  members: AlimtalkMemberAudience;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  groupIds: string[];

  @ApiProperty({ type: [ManualRecipientDto], description: '번호 직접 입력' })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ManualRecipientDto)
  manual: ManualRecipientDto[];

  @ApiProperty({ type: [VariableBindingDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => VariableBindingDto)
  variables: VariableBindingDto[];
}

export class CreateAlimtalkCampaignDto extends PreviewAlimtalkCampaignDto {
  @ApiProperty({ description: '화면이 확인창을 열 때 만든 id. 같은 id 로 다시 오면 새로 보내지 않는다' })
  @IsUUID()
  campaignId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: '예약 발송 시각. 비우면 바로 시작' })
  @IsOptional()
  @IsDateString()
  sendAt?: string;

  @ApiProperty({ description: '받는 사람 모두에게 해당하는 거래·계약 정보이고 광고가 아님을 확인했다' })
  @IsBoolean()
  @Equals(true, { message: '정보성 안내인지 확인해 주세요' })
  confirmInformational: boolean;
}
