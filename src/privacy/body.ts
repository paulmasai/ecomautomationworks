export class BodyError extends Error {
  constructor(readonly status: number) { super("Invalid request body"); }
}

export async function readLimitedBody(request: Request, maximum = 8192): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > maximum) throw new BodyError(413);
  const reader = request.body?.getReader();
  if (reader === undefined) throw new BodyError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new BodyError(413); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new BodyError(400); }
}
