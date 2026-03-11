import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * 메두사 네온db 5분 콜드스타터 방지 작업
 */
export default async function keepAliveJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  try {
    const start = Date.now();
    await pgConnection.raw("SELECT 1");
    const elapsed = Date.now() - start;

    logger.info(`[keep-alive] Database ping successful (${elapsed}ms)`);
  } catch (error) {
    logger.error(`[keep-alive] Database ping failed: ${error}`);
  }
}

export const config = {
  name: "keep-alive",
  schedule: "*/4 * * * *", // 4분마다 실행
};
