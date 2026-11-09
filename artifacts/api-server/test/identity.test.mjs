import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyIdentityToken } from "../src/lib/identity.ts";

const secret = "unit-test-identity-secret-at-least-32-bytes";
const now = Math.floor(Date.now() / 1000);

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(claimOverrides = {}, headerOverrides = {}) {
  const header = b64({ alg: "HS256", typ: "JWT", ...headerOverrides });
  const payload = b64({
    iss: "bibleapp-flask",
    aud: "bibleapp-api",
    sub: "42",
    iat: now,
    exp: now + 300,
    jti: "test-token-id-123456789",
    ...claimOverrides,
  });
  const input = header + "." + payload;
  const signature = createHmac("sha256", secret).update(input, "ascii").digest("base64url");
  return input + "." + signature;
}

test("accepts a correctly signed Flask identity token", () => {
  const claims = verifyIdentityToken(sign(), secret);
  assert.equal(claims.sub, "42");
  assert.equal(claims.iss, "bibleapp-flask");
  assert.equal(claims.aud, "bibleapp-api");
});

test("rejects an invalid signature", () => {
  const token = sign();
  assert.throws(() => verifyIdentityToken(token.slice(0, -1) + "x", secret));
});

test("rejects an expired token", () => {
  assert.throws(() => verifyIdentityToken(sign({ exp: now - 1 }), secret));
});

test("rejects the wrong issuer or audience", () => {
  assert.throws(() => verifyIdentityToken(sign({ iss: "other-issuer" }), secret));
  assert.throws(() => verifyIdentityToken(sign({ aud: "other-api" }), secret));
});

test("rejects tokens with more than five minutes of validity", () => {
  assert.throws(() => verifyIdentityToken(sign({ exp: now + 301 }), secret));
});

test("rejects non-HS256 headers and invalid account subjects", () => {
  assert.throws(() => verifyIdentityToken(sign({}, { alg: "none" }), secret));
  assert.throws(() => verifyIdentityToken(sign({ sub: "0" }), secret));
  assert.throws(() => verifyIdentityToken(sign({ sub: "42x" }), secret));
});

test("rejects malformed and oversized tokens", () => {
  assert.throws(() => verifyIdentityToken("not-a-jwt", secret));
  assert.throws(() => verifyIdentityToken("a".repeat(4097), secret));
});
