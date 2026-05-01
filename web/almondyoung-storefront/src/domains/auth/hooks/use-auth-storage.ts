"use client"

export function useAuthStorage() {
  const saveCredentials = (
    loginIdRemember: boolean,
    loginId: string,
    rememberMe: boolean
  ) => {
    if (typeof window === "undefined") return

    if (rememberMe) {
      // 자동 로그인 체크 시: 둘 다 저장
      localStorage.setItem("loginIdRemember", JSON.stringify(loginId))
      localStorage.setItem("rememberMe", JSON.stringify(true))
    } else if (loginIdRemember) {
      // 아이디 저장만 체크 시: 아이디만 저장, rememberMe는 삭제
      localStorage.setItem("loginIdRemember", JSON.stringify(loginId))
      localStorage.removeItem("rememberMe")
    } else {
      // 둘 다 체크 안 함: 모두 삭제
      localStorage.removeItem("loginIdRemember")
      localStorage.removeItem("rememberMe")
    }
  }

  const loadCredentials = () => {
    // 서버 사이드 렌더링 시 localStorage 접근 방지
    if (typeof window === "undefined") {
      return {
        loginId: "",
        rememberMe: false,
        loginIdRemember: false,
      }
    }

    const savedLoginId = localStorage.getItem("loginIdRemember")
    const savedRememberMe = localStorage.getItem("rememberMe")

    return {
      loginId: savedLoginId ? JSON.parse(savedLoginId) : "",
      rememberMe: savedRememberMe ? JSON.parse(savedRememberMe) : false,
      loginIdRemember: !!savedLoginId,
    }
  }

  return { saveCredentials, loadCredentials }
}
