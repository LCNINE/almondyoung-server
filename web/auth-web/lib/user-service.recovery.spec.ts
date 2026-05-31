import type {
  FindUserIdResult,
  ForgotPasswordResult,
  PhoneVerificationResult,
  ResetPasswordResult,
  SendPhoneVerificationResult,
} from "./user-service"
import {
  findUserId,
  forgotPassword,
  resetPassword,
  sendPhoneVerificationCode,
  verifyPhoneCode,
} from "./user-service"

async function assertRecoveryContracts() {
  const sendResult: SendPhoneVerificationResult =
    await sendPhoneVerificationCode({
      countryCode: "KR",
      phoneNumber: "+821012345678",
    })
  const verifyResult: PhoneVerificationResult = await verifyPhoneCode({
    phoneNumber: "+821012345678",
    code: "123456",
  })
  const findResult: FindUserIdResult = await findUserId({
    phoneNumber: "+821012345678",
  })
  const forgotResult: ForgotPasswordResult = await forgotPassword({
    loginId: "user123",
    phoneNumber: "+821012345678",
  })
  const resetResult: ResetPasswordResult = await resetPassword({
    token: forgotResult.verificationToken,
    password: "Password123!",
  })

  sendResult.success satisfies boolean
  verifyResult.success satisfies boolean
  findResult.loginIds satisfies string[]
  resetResult satisfies void
}

void assertRecoveryContracts
