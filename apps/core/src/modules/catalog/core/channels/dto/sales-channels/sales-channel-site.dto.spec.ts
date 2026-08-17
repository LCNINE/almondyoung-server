import { validate } from 'class-validator';
import { CreateSalesChannelDto } from './create-sales-channel.dto';
import { UpdateSalesChannelDto, ValidateChannelConfigDto } from './update-sales-channel.dto';

/**
 * `sales_channels.site` 의 어휘는 `SalesChannel`(`medusa | naver | coupang | 3pl`) 하나다
 * (ADR-0031 결정 7). 이 스펙이 그 어휘를 쓰기 경계에서 못 박는다.
 *
 * 어휘가 갈리면 채널 리스팅 조회(`channel-listing.service.ts` 의 `eq(salesChannels.site, channelCode)`)
 * 가 조용히 0행을 내고, 그 채널 주문은 전량 미식별로 격리된다. 400 으로 끊는 편이 낫다.
 */
describe('판매채널 site 어휘', () => {
  function createWith(site: unknown): CreateSalesChannelDto {
    const dto = new CreateSalesChannelDto();
    // 잘못된 런타임 값을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.site = site as CreateSalesChannelDto['site'];
    dto.name = '테스트 채널';
    return dto;
  }

  function updateWith(site: unknown): UpdateSalesChannelDto {
    const dto = new UpdateSalesChannelDto();
    dto.site = site as UpdateSalesChannelDto['site'];
    return dto;
  }

  function validateConfigWith(site: unknown): ValidateChannelConfigDto {
    const dto = new ValidateChannelConfigDto();
    dto.site = site as ValidateChannelConfigDto['site'];
    return dto;
  }

  async function siteErrors(dto: object): Promise<string[]> {
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'site').map((e) => e.property);
  }

  describe.each([
    ['CreateSalesChannelDto', createWith],
    ['UpdateSalesChannelDto', updateWith],
    ['ValidateChannelConfigDto', validateConfigWith],
  ])('%s', (_name, build) => {
    it.each(['medusa', 'naver', 'coupang', '3pl'])('SalesChannel 값 %s 를 받는다', async (site) => {
      await expect(siteErrors(build(site))).resolves.toHaveLength(0);
    });

    // 시드가 넣던 값. DB 에는 남아 있었지만 조회는 소문자로 오므로 서로 만나지 못했다.
    it('대문자 표기를 거부한다', async () => {
      await expect(siteErrors(build('MEDUSA'))).resolves.toHaveLength(1);
    });

    // 옛 어휘. `phone_order` 의 대응물은 `3pl` 이고, `other` 는 대응물이 없다.
    it.each(['phone_order', 'other'])('폐기된 어휘 %s 를 거부한다', async (site) => {
      await expect(siteErrors(build(site))).resolves.toHaveLength(1);
    });

    // 어댑터 내부 어휘가 새어 들어오는 경로를 막는다.
    it('어댑터 어휘 naver_smartstore 를 거부한다', async () => {
      await expect(siteErrors(build('naver_smartstore'))).resolves.toHaveLength(1);
    });
  });
});
