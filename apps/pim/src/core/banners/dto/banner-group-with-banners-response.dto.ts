import { ApiProperty } from '@nestjs/swagger';
import { BannerGroupResponseDto } from './banner-groups/banner-group-response.dto';
import { BannerResponseDto } from './banners/banner-response.dto';

export class BannerGroupWithBannersResponseDto extends BannerGroupResponseDto {
  @ApiProperty({
    description: '배너 목록',
    type: [BannerResponseDto],
  })
  banners: BannerResponseDto[];
}
