import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import { after, before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.BIBLEAPP_IDENTITY_TOKEN_SECRET = "unit-test-identity-secret-at-least-32-bytes";
process.env.BIBLEAPP_ALLOWED_ORIGINS = "https://reader.example";

const [{ default: bibleRouter }, { requireUserIdentity }, { pool }] = await Promise.all([
  import("../src/routes/bible.ts"),
  import("../src/lib/identity.ts"),
  import("@workspace/db"),
]);

const app = express();
app.use(express.json());
app.use("/api/bible", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
app.use("/api/bible", requireUserIdentity);
app.use("/api", bibleRouter);

let server;
let baseUrl;

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function tokenFor(userId = 42) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    iss: "bibleapp-flask",
    aud: "bibleapp-api",
    sub: String(userId),
    iat: now,
    exp: now + 300,
    jti: "route-test-token-id-123456",
  });
  const input = header + "." + payload;
  const signature = createHmac("sha256", process.env.BIBLEAPP_IDENTITY_TOKEN_SECRET)
    .update(input, "ascii").digest("base64url");
  return input + "." + signature;
}

async function request(path, init = {}) {
  return fetch(baseUrl + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + tokenFor(),
      Origin: "https://reader.example",
      ...(init.headers ?? {}),
    },
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

test("translation list is scoped to the verified account and marked no-store", async () => {
  const original = pool.query;
  let seenSql = "";
  let seenParams;
  pool.query = async (sql, params) => {
    seenSql = sql;
    seenParams = params;
    return { rowCount: 1, rows: [{ translation_id: 8, name: "Mine" }] };
  };
  try {
    const response = await request("/api/bible/translations");
    assert.equal(response.status, 200);
    assert.match(seenSql, /WHERE owner_id = \$1 OR/);
    assert.deepEqual(seenParams, [42]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await response.json()).translations, [
      { translation_id: 8, name: "Mine" },
    ]);
  } finally {
    pool.query = original;
  }
});

test("translation detail denies a non-owner before querying child rows", async () => {
  const original = pool.query;
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    return { rowCount: 0, rows: [] };
  };
  try {
    const response = await request("/api/bible/translations/88");
    assert.equal(response.status, 404);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /owner_id = \$2/);
  } finally {
    pool.query = original;
  }
});

test("choice write rejects a non-owner after row lock and performs no write", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql) {
      queries.push(sql);
      if (sql.includes("SELECT owner_id")) {
        return { rowCount: 1, rows: [{ owner_id: 99 }] };
      }
      return { rowCount: null, rows: [] };
    },
    release() {},
  });
  try {
    const response = await request("/api/bible/translations/88/choices/100", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: 1 }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(queries, [
      "BEGIN",
      "SELECT owner_id FROM translation WHERE translation_id = $1 FOR UPDATE",
      "ROLLBACK",
    ]);
  } finally {
    pool.connect = original;
  }
});

test("owner choice write is committed after row lock and parameterized writes", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT owner_id")) {
        return { rowCount: 1, rows: [{ owner_id: 42 }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    const response = await request("/api/bible/translations/88/choices/100", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: 2 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(queries.map((q) => q.sql), [
      "BEGIN",
      "SELECT owner_id FROM translation WHERE translation_id = $1 FOR UPDATE",
      "INSERT INTO word_choice (translation_id, word_id, choice) VALUES ($1, $2, $3) ON CONFLICT (translation_id, word_id) DO UPDATE SET choice = EXCLUDED.choice",
      "UPDATE translation SET updated_at = CURRENT_TIMESTAMP WHERE translation_id = $1",
      "COMMIT",
    ]);
    assert.deepEqual(queries[2].params, [88, 100, 2]);
  } finally {
    pool.connect = original;
  }
});

test("Other-option creation locks and authorizes the translation before insert", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT owner_id")) {
        return { rowCount: 1, rows: [{ owner_id: 42 }] };
      }
      if (sql.includes("INSERT INTO other_option")) {
        return { rowCount: 1, rows: [{
          option_id: 4, translation_id: 88, idx: 1, text: "rendering",
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    const response = await request("/api/bible/translations/88/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "rendering" }),
    });
    assert.equal(response.status, 201);
    assert.equal(queries[1].sql,
      "SELECT owner_id FROM translation WHERE translation_id = $1 FOR UPDATE");
    assert.match(queries[2].sql, /COALESCE\(MAX\(idx\), 0\) \+ 1/);
    assert.deepEqual(queries[2].params, [88, "rendering"]);
    assert.equal(queries.at(-1).sql, "COMMIT");
  } finally {
    pool.connect = original;
  }
});
