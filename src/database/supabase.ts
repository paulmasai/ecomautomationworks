import type { AppConfig } from "../config/env";

export class DatabaseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("A database operation failed");
    this.name = "DatabaseError";
    this.status = status;
  }
}

export class SupabaseDatabase {
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(config: Pick<AppConfig, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">) {
    this.baseUrl = config.SUPABASE_URL.replace(/\/$/, "");
    this.headers = {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    };
  }

  async rpc<T>(functionName: string, body: unknown): Promise<T> {
    const response = await fetch(
      `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      // The response body may contain submitted data or internal SQL details.
      throw new DatabaseError(response.status);
    }

    return (await response.json()) as T;
  }

  async select<T>(
    table: string,
    query: Readonly<Record<string, string>>,
  ): Promise<T[]> {
    const search = new URLSearchParams(query);
    const response = await fetch(
      `${this.baseUrl}/rest/v1/${encodeURIComponent(table)}?${search.toString()}`,
      { headers: this.headers },
    );

    if (!response.ok) throw new DatabaseError(response.status);
    return (await response.json()) as T[];
  }

  async insert<T>(table: string, body: unknown): Promise<T[]> {
    const response = await fetch(
      `${this.baseUrl}/rest/v1/${encodeURIComponent(table)}`,
      {
        method: "POST",
        headers: {
          ...this.headers,
          prefer: "return=representation",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) throw new DatabaseError(response.status);
    return (await response.json()) as T[];
  }

  async update(
    table: string,
    query: Readonly<Record<string, string>>,
    body: unknown,
  ): Promise<void> {
    const search = new URLSearchParams(query);
    const response = await fetch(
      `${this.baseUrl}/rest/v1/${encodeURIComponent(table)}?${search.toString()}`,
      {
        method: "PATCH",
        headers: {
          ...this.headers,
          prefer: "return=minimal",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) throw new DatabaseError(response.status);
  }

  async updateReturning<T>(
    table: string,
    query: Readonly<Record<string, string>>,
    body: unknown,
  ): Promise<T[]> {
    const search = new URLSearchParams(query);
    const response = await fetch(
      `${this.baseUrl}/rest/v1/${encodeURIComponent(table)}?${search.toString()}`,
      {
        method: "PATCH",
        headers: {
          ...this.headers,
          prefer: "return=representation",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) throw new DatabaseError(response.status);
    return (await response.json()) as T[];
  }
}
