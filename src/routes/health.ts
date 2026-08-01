import type { AppConfig } from "../config/env";
import { jsonResponse } from "../utilities/http";

export function handleHealth(
  config: Pick<AppConfig, "ENVIRONMENT">,
): Response {
  return jsonResponse({
    status: "ok",
    service: "mobdeals-meta-automation-suite",
    environment: config.ENVIRONMENT,
  });
}
