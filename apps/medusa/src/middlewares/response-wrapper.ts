// src/api/middlewares/response-wrapper.ts
import type { Request, Response, NextFunction } from 'express';

export function responseWrapper(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const oldSend = res.send.bind(res);

  res.send = function (body: any) {
    try {
      const json = typeof body === 'string' ? JSON.parse(body) : body;

      if (json && typeof json === 'object' && 'success' in json) {
        return oldSend(JSON.stringify(json));
      }

      return oldSend(
        JSON.stringify({
          success: true,
          data: json,
        }),
      );
    } catch {
      return oldSend(body);
    }
  };

  next();
}
