import { Modules } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

/**
 * 로컬 개발용 Admin secret API key 발급.
 *
 * channel-adapter 의 MEDUSA_API_KEY 는 라이브/dev 키라 로컬 Medusa 에선 401 이 난다.
 * 이 스크립트로 로컬 전용 키를 만들어 apps/channel-adapter/.env.local 에 넣는다.
 * 평문 토큰은 발급 시 한 번만 반환되므로 출력값을 바로 복사해야 한다.
 *
 * 사용: cd apps/medusa && npx medusa exec ./src/scripts/create-local-secret-key.ts
 */
export default async function createLocalSecretKey({ container }: ExecArgs) {
  const apiKeyModule = container.resolve(Modules.API_KEY)

  const [created] = await apiKeyModule.createApiKeys([
    {
      title: `local-dev-${Date.now()}`,
      type: "secret",
      created_by: "local-dev-script",
    },
  ])

  console.log("\nMEDUSA_API_KEY=" + created.token + "\n")
}
