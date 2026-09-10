import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createLogger } from "./logger";
import { NotFoundError } from "./storage/projects";
import { errorMessage } from "./util";

const log = createLogger("api");

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof NotFoundError) return json({ error: err.message }, 404);
  if (err instanceof ZodError) return json({ error: "Invalid request", issues: err.issues }, 400);
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  log.error("unhandled API error", err);
  return json({ error: errorMessage(err) }, 500);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Params<T extends Record<string, string | string[]>> = { params: Promise<T> };
