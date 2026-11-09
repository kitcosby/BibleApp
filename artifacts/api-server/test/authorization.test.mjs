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

test("Other-option creation deduplicates, enforces the cap, and assigns the next index", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT owner_id")) {
        return { rowCount: 1, rows: [{ owner_id: 42 }] };
      }
      if (sql.includes("SELECT option_id, translation_id")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SELECT COUNT(*)")) {
        return { rowCount: 1, rows: [{ count: 2, max_idx: 4 }] };
      }
      if (sql.includes("INSERT INTO other_option")) {
        return { rowCount: 1, rows: [{
          option_id: 5, translation_id: 88, idx: 5, text: "rendering",
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
    assert.match(queries[2].sql, /text = \$2/);
    assert.match(queries[3].sql, /COUNT\(\*\)/);
    assert.deepEqual(queries[4].params, [88, 5, "rendering"]);
    assert.equal(queries.at(-1).sql, "COMMIT");
  } finally {
    pool.connect = original;
  }
});


test("translation creation assigns owner from verified identity and satisfies legacy app_user FK", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT user_id FROM app_user")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO app_user")) {
        return { rowCount: 1, rows: [{ user_id: 7 }] };
      }
      if (sql.includes("INSERT INTO translation")) {
        return { rowCount: 1, rows: [{
          translation_id: 9, name: "My Translation", description: "Notes",
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    const response = await request("/api/bible/translations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Translation", description: "Notes" }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(queries.map((q) => q.sql), [
      "BEGIN",
      "SELECT user_id FROM app_user ORDER BY user_id LIMIT 1",
      "INSERT INTO app_user(name) VALUES($1) RETURNING user_id",
      "INSERT INTO translation(user_id, name, description, owner_id) VALUES($1, $2, $3, $4) RETURNING translation_id, name, description, created_at, updated_at",
      "COMMIT",
    ]);
    assert.deepEqual(queries[3].params, [7, "My Translation", "Notes", 42]);
  } finally {
    pool.connect = original;
  }
});

test("choice retrieval authorizes translation before returning only requested word IDs", async () => {
  const original = pool.query;
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    if (queries.length === 1)
      return { rowCount: 1, rows: [{ translation_id: 88 }] };
    return { rowCount: 2, rows: [
      { word_id: 100, choice: 2 }, { word_id: 101, choice: 4 },
    ] };
  };
  try {
    const response = await request("/api/bible/translations/88/choices?wordIds=100,101,100");
    assert.equal(response.status, 200);
    assert.match(queries[0].sql, /owner_id = \$2/);
    assert.deepEqual(queries[0].params, [88, 42]);
    assert.match(queries[1].sql, /word_id = ANY\(\$2::int\[\]\)/);
    assert.deepEqual(queries[1].params, [88, [100, 101]]);
    assert.deepEqual((await response.json()).choices, [
      { word_id: 100, choice: 2 }, { word_id: 101, choice: 4 },
    ]);
  } finally {
    pool.query = original;
  }
});

test("choice retrieval denies a non-owner before reading choices", async () => {
  const original = pool.query;
  let calls = 0;
  pool.query = async () => {
    calls += 1;
    return { rowCount: 0, rows: [] };
  };
  try {
    const response = await request("/api/bible/translations/88/choices?wordIds=100");
    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  } finally {
    pool.query = original;
  }
});

test("choice write updates word choice and forward-only lemma default in one transaction", async () => {
  const original = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT owner_id"))
        return { rowCount: 1, rows: [{ owner_id: 42 }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    const response = await request("/api/bible/translations/88/choices/100", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        choice: 2,
        lemmaDefault: {
          lemma: "H430", rendering: "God", fromWordId: 100,
          source: 1, otherOptionId: null,
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(queries[3].sql,
      "INSERT INTO lemma_default (translation_id, lemma, rendering, from_word_id, source, other_option_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (translation_id, lemma) DO UPDATE SET rendering = EXCLUDED.rendering, from_word_id = EXCLUDED.from_word_id, source = EXCLUDED.source, other_option_id = EXCLUDED.other_option_id");
    assert.deepEqual(queries[3].params, [88, "H430", "God", 100, 1, null]);
    assert.equal(queries.at(-1).sql, "COMMIT");
  } finally {
    pool.connect = original;
  }
});
