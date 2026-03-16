import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"


export function logHeadersMiddleware(
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
) {
    // 프로덕션에서는 로깅 최소화
    if (process.env.NODE_ENV === "production") {
        return next()
    }

    const authHeader = req.headers.authorization
    const mask = (value?: string | string[]) => {
        if (!value) return "Missing"
        const v = Array.isArray(value) ? value[0] : value
        return v.length > 6 ? `${v.slice(0, 6)}...` : "Present"
    }

    console.log(`[Admin] ${req.method} ${req.url} | auth: ${mask(authHeader)}`)

    return next()
}
