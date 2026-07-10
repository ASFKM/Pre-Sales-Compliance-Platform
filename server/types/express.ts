import type { Request as ExpressRequest } from "express";

// @types/express-serve-static-core v5 (pulled in by the Express 5 upgrade) widened
// ParamsDictionary's index signature to `string | string[]` to support path-to-regexp v8's
// repeatable-capture routes (e.g. "/files/*splat" matching multiple segments). This app has no
// routes like that - every param is a single named segment (":projectId", ":id", etc.) that only
// ever resolves to a single string at runtime. Route files import Request from here instead of
// "express" directly so every `req.params.x` stays typed as `string`, matching actual runtime
// behavior, instead of every route handler needing its own cast at each usage.
export type Request = ExpressRequest<Record<string, string>>;
