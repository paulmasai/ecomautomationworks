import { createApp } from "./app";
import type { Env } from "./types/env";

const handleRequest = createApp();

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return handleRequest(request, env, context);
  },
} satisfies ExportedHandler<Env>;
