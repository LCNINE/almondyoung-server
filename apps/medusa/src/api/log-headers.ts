
import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

export async function logHeadersMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
) {
    const logger = req.scope.resolve("logger")

    if (req.url.startsWith("/admin")) {
        logger.info(`[Admin Request] ${req.method} ${req.url}`)
        logger.info(`Headers: ${JSON.stringify({
            authorization: req.headers.authorization ? "Present" : "Missing",
            "x-medusa-access-token": req.headers["x-medusa-access-token"] ? "Present" : "Missing",
            cookie: req.headers.cookie ? "Present" : "Missing"
        })}`)
    }

    return next()
}
