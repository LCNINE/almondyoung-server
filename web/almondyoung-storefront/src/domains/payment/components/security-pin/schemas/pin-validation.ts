import { z } from "zod"
import { PinPolicyUtil } from "../../utils"

export const pinSetupSchema = z
  .object({
    firstPin: z
      .string()
      .length(6, "PIN은 6자리여야 합니다")
      .regex(/^\d{6}$/, "숫자만 입력 가능합니다")
      .refine(
        (pin) => PinPolicyUtil.isValid(pin),
        "취약한 PIN입니다. 동일한 숫자 반복 또는 연속된 숫자는 사용할 수 없습니다"
      ),
    secondPin: z.string().length(6, "PIN은 6자리여야 합니다"),
  })
  .refine((data) => data.firstPin === data.secondPin, {
    message: "PIN이 일치하지 않습니다",
    path: ["secondPin"],
  })

export type PinSetupFormValues = z.infer<typeof pinSetupSchema>
