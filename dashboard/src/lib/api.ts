import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

interface PublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

let clientPromise: Promise<SupabaseClient> | undefined;

export function getSupabaseClient(): Promise<SupabaseClient> {
  clientPromise ??= fetch("/api/config", {
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Dashboard authentication is unavailable");
      return (await response.json()) as PublicConfig;
    })
    .then((config) =>
      createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      }),
    );

  return clientPromise;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const client = await getSupabaseClient();
  const { data } = await client.auth.getSession();
  const session: Session | null = data.session;
  if (session === null) throw new Error("Authentication required");

  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.access_token}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? "Dashboard request failed");
  }

  return (await response.json()) as T;
}
