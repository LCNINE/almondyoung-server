import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import {
  BusinessInfoDto,
  UserDetailDto,
  UserVerificationStatusDto,
} from "@lib/types/dto/users"
import { getCookies } from "@lib/data/cookies"
import { api } from "@lib/api/api"

export const getVerificationStatus =
  async (): Promise<UserVerificationStatusDto> => {
    try {
      const currentUser = await api<UserDetailDto>("users", "/users/detail", {
        method: "GET",
        cache: "no-store",
        withAuth: true,
      })

      const businessInfo = await api<BusinessInfoDto | null>(
        "users",
        "/business-licenses/me",
        {
          method: "GET",
          withAuth: true,
        }
      )

      const verificationStatus: UserVerificationStatusDto = {
        birthDate: currentUser.profile?.birthDate ? "verified" : "none",
        phone: currentUser.profile?.phoneNumber ? "verified" : "none",
        business: {
          status:
            businessInfo?.status === "approved"
              ? "verified"
              : businessInfo?.status === "rejected"
                ? "rejected"
                : businessInfo?.status === "under_review"
                  ? "under_review"
                  : "none",
          rejectionReason: businessInfo?.reviewComment ?? null,
        },
      }

      return verificationStatus
    } catch (error) {
      console.error("Failed to get verification status:", error)
      throw error
    }
  }
