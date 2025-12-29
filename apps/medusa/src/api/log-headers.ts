
import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

export async function logHeadersMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
) {
    const logger = req.scope.resolve("logger")

    // if (req.url.startsWith("/admin")) { // Removed check as matcher handles it
    {
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

        logger.info(`[Admin Request] ${req.method} ${req.url} (original: ${req.originalUrl})`)
        logger.info(`Headers: ${JSON.stringify(masked)}`)
        console.log("[Admin Request][headers]", masked)

        // DEBUG: Try to authenticate API key manually
        if (authHeader && authHeader.startsWith("Basic ")) {
            try {
                const fs = require('fs');
                const logFile = '/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa/debug.log';
                const log = (msg: string) => {
                    try { fs.appendFileSync(logFile, msg + '\n'); } catch (e) { }
                };

                const tokenPart = authHeader.split(" ")[1]
                let normalizedToken = tokenPart
                if (!tokenPart.startsWith("sk_")) {
                    normalizedToken = Buffer.from(tokenPart, "base64").toString("utf-8")
                }
                if (normalizedToken.endsWith(":")) {
                    normalizedToken = normalizedToken.slice(0, -1)
                }

                if (normalizedToken.startsWith("sk_")) {
                    const apiKeyModule = req.scope.resolve("api_key")
                    log(`[Debug] Attempting to auth key: ${mask(normalizedToken)}`)
                    console.log("[Debug] Attempting to auth key:", mask(normalizedToken))
                    try {
                        const authResult = await apiKeyModule.authenticate(normalizedToken)
                        log(`[Debug] Auth result: ${authResult ? "Success" : "Failed (null)"}`)
                        console.log("[Debug] Auth result:", authResult ? "Success" : "Failed (null)")
                        if (authResult) {
                            log(`[Debug] Auth user: ${authResult.title}`)
                            console.log("[Debug] Auth user:", authResult.title)
                        }
                    } catch (e) {
                        log(`[Debug] Auth error: ${e.message}`)
                        console.log("[Debug] Auth error:", e.message)
                        console.error(e)
                    }
                } else {
                    log(`[Debug] Token does not start with sk_: ${mask(normalizedToken)}`)
                    console.log("[Debug] Token does not start with sk_:", mask(normalizedToken))
                }
            } catch (e) {
                const fs = require('fs');
                try { fs.appendFileSync('/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa/debug.log', `[Debug] Manual auth check failed: ${e.message}\n`); } catch (err) { }
                console.log("[Debug] Manual auth check failed:", e.message)
            }
        }
    }

    return next()
}
