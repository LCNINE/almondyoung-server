import { ApiError } from "@lib/api-error"
import { createUser } from "@lib/api/users/auth"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { UseFormReturn } from "react-hook-form"
import { toast } from "sonner"
import { SignupSchema } from "../schemas/signup-schema"

export const useSignup = (form: UseFormReturn<SignupSchema>) => {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const signup = async (data: SignupSchema) => {
    setIsLoading(true)

    try {
      const { passwordConfirm, ...submitData } = data
      const response = await createUser(submitData)

      if (response) {
        toast(response.message, {
          action: {
            label: "확인",
            onClick: () => {
              return
            },
          },
        })
      }

      return response
    } catch (err) {
      if (err instanceof ApiError) {
        const errorMessage = err.message
        if (err.status === 409) {
          if (errorMessage.includes("아이디")) {
            form.setError("loginId", {
              message: "이미 존재하는 아이디입니다.",
            })
            toast.error("이미 존재하는 아이디입니다.")
            return
          }
          if (errorMessage.includes("이메일")) {
            form.setError("email", {
              message: "이미 존재하는 이메일입니다.",
            })
            toast.error("이미 존재하는 이메일입니다.")
            return
          }
          if (errorMessage.includes("닉네임")) {
            form.setError("nickname", {
              message: "이미 존재하는 닉네임입니다.",
            })
            toast.error("이미 존재하는 닉네임입니다.")
            return
          }
        }
        if (err.status === 400) {
          if (errorMessage.includes("최소")) {
            form.setError("username", {
              message: "이름은 최소 2자 이상이어야 합니다.",
            })
            toast.error("이름은 최소 2자 이상이어야 합니다.")
            return
          }
          toast.error(errorMessage)
          return
        }
        if (err.status >= 500) {
          toast.error("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.")
          return
        }
        // 기타 에러
        toast.error(
          errorMessage || "회원가입에 실패했습니다. 잠시 후 다시 시도해주세요."
        )
      }

      toast.error("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.")
    } finally {
      setIsLoading(false)
    }
  }

  return {
    signup,
    isLoading,
  }
}
