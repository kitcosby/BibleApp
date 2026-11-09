import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

type IdentityClaims = {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

function decodeSegment(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error("Invalid token encoding");
  }
  return Buffer.from(segment, "base64url");
}

export function verifyIdentityToken(token: string, secret: string): IdentityClaims {
  if (token.length > 4096) throw new Error("Token too large");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(decodeSegment(encodedHeader).toString("utf8"));
  if (header?.alg !== "HS256" || header?.typ !== "JWT") {
    throw new Error("Unsupported token");
  }

  const supplied = decodeSegment(encodedSignature);
  const expected = createHmac("sha256", secret)
    .update(encodedHeader + "." + encodedPayload, "ascii")
    .digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid signature");
  }

  const claims = JSON.parse(decodeSegment(encodedPayload).toString("utf8")) as IdentityClaims;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims?.iss !== "bibleapp-flask" ||
    claims?.aud !== "bibleapp-api" ||
    typeof claims.sub !== "string" ||
    !/^[1-9][0-9]*$/.test(claims.sub) ||
    !Number.isSafeInteger(Number(claims.sub)) ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    typeof claims.jti !== "string" ||
    claims.jti.length < 16 ||
    claims.exp <= now ||
    claims.iat > now + 30 ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 300
  ) {
    throw new Error("Invalid or expired claims");
  }
  return claims;
}

export function requireUserIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const secret = process.env.BIBLEAPP_IDENTITY_TOKEN_SECRET ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    res.status(503).json({ error: "Identity service unavailable" });
    return;
  }
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
  if (!match) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const claims = verifyIdentityToken(match[1], secret);
    res.locals.auth = { userId: Number(claims.sub), tokenId: claims.jti };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired identity token" });
  }
}
