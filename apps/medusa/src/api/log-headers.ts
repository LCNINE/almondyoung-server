
import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

export async function logHeadersMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
) {
    const logger = req.scope.resolve("logger")

    if (req.url.startsWith("/admin")) {
        const authHeader = req.headers.authorization
        // 민감 정보 마스킹 (앞 6글자만 노출)
        const mask = (value?: string | string[]) => {
            if (!value) return "Missing"
            const v = Array.isArray(value) ? value[0] : value
            return v.length > 6 ? `${v.slice(0, 6)}...(${v.length} chars)` : "Present"
        }

        const masked = {
            authorization: mask(authHeader),
            "x-medusa-access-token": mask(req.headers["x-medusa-access-token"]),
            cookie: req.headers.cookie ? "Present" : "Missing",
        }

        logger.info(`[Admin Request] ${req.method} ${req.url}`)
        logger.info(`Headers: ${JSON.stringify(masked)}`)
        console.log("[Admin Request][headers]", masked)
    }

    return next()
}
