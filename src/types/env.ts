export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_PAGE_ID: string;
  META_PAGE_ACCESS_TOKEN: string;
  META_VERIFY_TOKEN: string;
  META_GRAPH_API_VERSION: string;
  INTERNAL_ADMIN_SECRET: string;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  OUTBOUND_ACTIONS_ENABLED?: string;
  META_EVENTS_QUEUE?: Queue<MetaEventQueueMessage>;
}

export interface MetaEventQueueMessage {
  eventId: string;
  externalEventId: string;
}
