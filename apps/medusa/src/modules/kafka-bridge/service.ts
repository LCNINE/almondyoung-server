import { MedusaService } from '@medusajs/framework/utils';

/**
 * Kafka Bridge 모듈 서비스
 * 실제 로직은 loader에서 처리하며, 이 서비스는 모듈 요구사항을 충족하기 위한 빈 서비스입니다.
 */
class KafkaBridgeModuleService extends MedusaService({}) {
  constructor() {
    super(...arguments);
  }
}

export default KafkaBridgeModuleService;
