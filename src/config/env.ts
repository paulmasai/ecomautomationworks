import { z } from "zod";
import type { Env } from "../types/env";

const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Must use HTTPS");

const secret = z.string().min(16).max(4096);

const environmentSchema = z.object({
  SUPABASE_URL: httpsUrl,
  SUPABASE_SERVICE_ROLE_KEY: secret,
  META_APP_ID: z.string().min(1).max(256),
  META_APP_SECRET: secret,
  META_PAGE_ID: z.string().min(1).max(256),
  META_PAGE_ACCESS_TOKEN: secret,
  META_VERIFY_TOKEN: secret,
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
  INTERNAL_ADMIN_SECRET: secret,
  ENVIRONMENT: z.enum(["development", "staging", "production"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
  OUTBOUND_ACTIONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {
  constructor() {
    super("The service configuration is invalid");
    this.name = "ConfigurationError";
  }
}

export function loadConfig(env: Env): AppConfig {
  const result = environmentSchema.safeParse(env);

  if (!result.success) {
    // Validation details can reveal secret lengths or configuration structure.
    throw new ConfigurationError();
  }

  return result.data;
}
