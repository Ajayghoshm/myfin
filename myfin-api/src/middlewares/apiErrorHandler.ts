import APIError, { CommonApiErrorCode } from "../errorHandling/apiError.js";
import { NextFunction, Request, Response } from "express";
import Logger from "../utils/Logger.js";

// eslint-disable-next-line no-unused-vars
export function apiErrorHandler(err: { message: string, code: string, type: string } | undefined, req: Request, res: Response, next: NextFunction) {
  const errorMessage = err.message ? err.message : "Something went wrong.";

  if (err instanceof APIError) {
    res.status(err.code).json({
      message: errorMessage,
      rationale: err.rationale,
    });
    return;
  }
  // request validation failures (joi) are the client's error
  if ((err as { isJoi?: boolean }).isJoi) {
    res.status(400).json({ message: errorMessage });
    return;
  }
  Logger.addStringifiedLog(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ rationale: CommonApiErrorCode.RequestPayloadTooLarge});
  }

  res.status(500).json({
    message: errorMessage
  });
}
