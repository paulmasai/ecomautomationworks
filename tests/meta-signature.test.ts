import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "../src/security/crypto";
import { signBody } from "./helpers";

const secret = "test-app-secret-123456789";

describe("Meta request signature verification", () => {
  it("accepts a valid SHA-256 HMAC", async () => {
    const body = new TextEncoder().encode('{"object":"page"}');
    const signature = await signBody('{"object":"page"}', secret);

    await expect(
      verifyMetaSignature(body.buffer, signature, secret),
    ).resolves.toBe(true);
  });

  it("rejects a signature generated with a different secret", async () => {
    const body = new TextEncoder().encode('{"object":"page"}');
    const signature = await signBody(
      '{"object":"page"}',
      "different-app-secret-123456",
    );

    await expect(
      verifyMetaSignature(body.buffer, signature, secret),
    ).resolves.toBe(false);
  });

  it.each([null, "", "sha1=abc", "sha256=xyz"])(
    "rejects a missing or malformed signature: %s",
    async (signature) => {
      const body = new TextEncoder().encode("{}");
      await expect(
        verifyMetaSignature(body.buffer, signature, secret),
      ).resolves.toBe(false);
    },
  );
});
