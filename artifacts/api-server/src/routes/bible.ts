import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function authenticatedUserId(res: Response): number {
  return Number(res.locals.auth?.userId);
}

function isValidUserId(userId: number): boolean {
  return Number.isSafeInteger(userId) && userId > 0;
}

function reqError(res: Response, error: unknown) {
  // Keep SQL details and credentials out of client responses.
  res.status(500).json({ error: "Database request failed" });
}

router.get("/bible/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});


router.post("/bible/translations", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  if (!isValidUserId(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body?.description === "string"
    ? req.body.description.trim() : "";
  if (!name || name.length > 120 || description.length > 2000) {
    res.status(400).json({ error: "A translation name (1–120 characters) and description (up to 2000 characters) are required" });
    return;
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // translation.user_id is a legacy NOT NULL FK, not the identity authority.
    // owner_id is always set from the verified Flask-issued account token.
    const legacyUser = await client.query(
      "SELECT user_id FROM app_user ORDER BY user_id LIMIT 1",
    );
    let legacyUserId = legacyUser.rows[0]?.user_id;
    if (!legacyUserId) {
      const inserted = await client.query(
        "INSERT INTO app_user(name) VALUES($1) RETURNING user_id",
        ["BibleApp"],
      );
      legacyUserId = inserted.rows[0]?.user_id;
    }
    const result = await client.query(
      "INSERT INTO translation(user_id, name, description, owner_id) " +
      "VALUES($1, $2, $3, $4) " +
      "RETURNING translation_id, name, description, created_at, updated_at",
      [legacyUserId, name, description, userId],
    );
    await client.query("COMMIT");
    res.status(201).json({ translation: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    reqError(res, error);
  } finally {
    client?.release();
  }
});

router.get("/bible/translations", async (_req, res) => {
  const userId = authenticatedUserId(res);
  if (!isValidUserId(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const result = await pool.query(
      "SELECT translation_id, name, description, created_at, updated_at " +
      "FROM translation " +
      "WHERE owner_id = $1 OR (owner_id IS NULL AND " +
      "((translation_id = 1 AND name = 'KJV') OR " +
      "(translation_id = 2 AND name = 'Young''s'))) " +
      "ORDER BY updated_at DESC, translation_id DESC",
      [userId],
    );
    res.json({ translations: result.rows });
  } catch (error) {
    reqError(res, error);
  }
});


router.get("/bible/translations/:translationId/choices", async (req, res) => {
  const userId = authenticatedUserId(res);
  if (!isValidUserId(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const translationId = Number(req.params.translationId);
  const rawIds = typeof req.query.wordIds === "string" ? req.query.wordIds : "";
  const wordIds = rawIds.split(",").filter(Boolean).map(Number);
  if (!Number.isSafeInteger(translationId) || translationId < 1 ||
      !wordIds.length || wordIds.length > 100 ||
      wordIds.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 264217)) {
    res.status(400).json({ error: "A valid translationId and 1–100 wordIds are required" });
    return;
  }
  try {
    const authorized = await pool.query(
      "SELECT translation_id FROM translation WHERE translation_id = $1 AND " +
      "(owner_id = $2 OR (owner_id IS NULL AND " +
      "((translation_id = 1 AND name = 'KJV') OR " +
      "(translation_id = 2 AND name = 'Young''s'))))",
      [translationId, userId],
    );
    if (!authorized.rowCount) {
      res.status(404).json({ error: "Translation not found" });
      return;
    }
    const result = await pool.query(
      "SELECT word_id, choice FROM word_choice " +
      "WHERE translation_id = $1 AND word_id = ANY($2::int[]) ORDER BY word_id",
      [translationId, [...new Set(wordIds)]],
    );
    res.json({ choices: result.rows });
  } catch (error) {
    reqError(res, error);
  }
});

router.get("/bible/translations/:translationId", async (req, res) => {
  const userId = authenticatedUserId(res);
  if (!isValidUserId(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const translationId = Number(req.params.translationId);
  if (!Number.isSafeInteger(translationId) || translationId < 1) {
    res.status(400).json({ error: "Invalid translationId" });
    return;
  }
  try {
    // Authorize the parent row before querying any child data.
    const translation = await pool.query(
      "SELECT translation_id, name, description, created_at, updated_at " +
      "FROM translation WHERE translation_id = $1 AND " +
      "(owner_id = $2 OR (owner_id IS NULL AND " +
      "((translation_id = 1 AND name = 'KJV') OR " +
      "(translation_id = 2 AND name = 'Young''s'))))",
      [translationId, userId],
    );
    if (!translation.rowCount) {
      res.status(404).json({ error: "Translation not found" });
      return;
    }

    const [options, choiceCount, defaults] = await Promise.all([
      pool.query(
        "SELECT option_id, translation_id, idx, text, created_at " +
        "FROM other_option WHERE translation_id = $1 ORDER BY idx",
        [translationId],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM word_choice WHERE translation_id = $1",
        [translationId],
      ),
      pool.query(
        "SELECT lemma, rendering, from_word_id, source, other_option_id " +
        "FROM lemma_default WHERE translation_id = $1 ORDER BY lemma",
        [translationId],
      ),
    ]);
    res.json({
      translation: translation.rows[0],
      otherOptions: options.rows,
      selectedWordCount: choiceCount.rows[0]?.count ?? 0,
      lemmaDefaults: defaults.rows,
    });
  } catch (error) {
    reqError(res, error);
  }
});

router.put(
  "/bible/translations/:translationId/choices/:wordId",
  async (req: Request, res: Response) => {
    const userId = authenticatedUserId(res);
    if (!isValidUserId(userId)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const translationId = Number(req.params.translationId);
    const wordId = Number(req.params.wordId);
    const choice = Number(req.body?.choice);
    if (
      !Number.isSafeInteger(translationId) || translationId < 1 ||
      !Number.isSafeInteger(wordId) || wordId < 1 || wordId > 264217 ||
      !Number.isInteger(choice) || choice < 0 || choice > 255
    ) {
      res.status(400).json({ error: "translationId, wordId, or choice is invalid" });
      return;
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const translation = await client.query(
        "SELECT owner_id FROM translation WHERE translation_id = $1 FOR UPDATE",
        [translationId],
      );
      if (
        !translation.rowCount ||
        translation.rows[0].owner_id == null ||
        Number(translation.rows[0].owner_id) !== userId
      ) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Translation not found" });
        return;
      }

      if (choice === 0) {
        await client.query(
          "DELETE FROM word_choice WHERE translation_id = $1 AND word_id = $2",
          [translationId, wordId],
        );
      } else {
        await client.query(
          "INSERT INTO word_choice (translation_id, word_id, choice) " +
          "VALUES ($1, $2, $3) " +
          "ON CONFLICT (translation_id, word_id) " +
          "DO UPDATE SET choice = EXCLUDED.choice",
          [translationId, wordId, choice],
        );
      }

      // A non-default selection also becomes the forward-only lemma default,
      // matching Flask's record_lemma_default() behavior. Choice 0 removes
      // only the per-word override; it does not erase the lemma default.
      const lemmaDefault = req.body?.lemmaDefault;
      if (lemmaDefault !== undefined) {
        const lemma = typeof lemmaDefault?.lemma === "string"
          ? lemmaDefault.lemma.trim() : "";
        const rendering = typeof lemmaDefault?.rendering === "string"
          ? lemmaDefault.rendering : "";
        const fromWordId = Number(lemmaDefault?.fromWordId);
        const source = Number(lemmaDefault?.source);
        const otherOptionId = lemmaDefault?.otherOptionId == null
          ? null : Number(lemmaDefault.otherOptionId);
        if (!lemma || lemma.length > 128 || !rendering || rendering.length > 2000 ||
            !Number.isSafeInteger(fromWordId) || fromWordId < 1 || fromWordId > 264217 ||
            ![1, 2, 3].includes(source) ||
            (otherOptionId !== null && (!Number.isSafeInteger(otherOptionId) || otherOptionId < 1)) ||
            (source === 3 && otherOptionId === null) ||
            (source !== 3 && otherOptionId !== null)) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "Invalid lemmaDefault" });
          return;
        }
        if (source === 3) {
          const option = await client.query(
            "SELECT option_id FROM other_option " +
            "WHERE option_id = $1 AND translation_id = $2",
            [otherOptionId, translationId],
          );
          if (!option.rowCount) {
            await client.query("ROLLBACK");
            res.status(400).json({ error: "lemmaDefault option does not belong to this translation" });
            return;
          }
        }
        await client.query(
          "INSERT INTO lemma_default " +
          "(translation_id, lemma, rendering, from_word_id, source, other_option_id) " +
          "VALUES ($1, $2, $3, $4, $5, $6) " +
          "ON CONFLICT (translation_id, lemma) DO UPDATE SET " +
          "rendering = EXCLUDED.rendering, from_word_id = EXCLUDED.from_word_id, " +
          "source = EXCLUDED.source, other_option_id = EXCLUDED.other_option_id",
          [translationId, lemma, rendering, fromWordId, source, otherOptionId],
        );
      }
      await client.query(
        "UPDATE translation SET updated_at = CURRENT_TIMESTAMP WHERE translation_id = $1",
        [translationId],
      );
      await client.query("COMMIT");
      res.json({ saved: true, translationId, wordId, choice });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      reqError(res, error);
    } finally {
      client?.release();
    }
  },
);

router.post(
  "/bible/translations/:translationId/options",
  async (req: Request, res: Response) => {
    const userId = authenticatedUserId(res);
    if (!isValidUserId(userId)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const translationId = Number(req.params.translationId);
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!Number.isSafeInteger(translationId) || translationId < 1 || !text || text.length > 2000) {
      res.status(400).json({ error: "A valid translationId and option text are required" });
      return;
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const translation = await client.query(
        "SELECT owner_id FROM translation WHERE translation_id = $1 FOR UPDATE",
        [translationId],
      );
      if (
        !translation.rowCount ||
        translation.rows[0].owner_id == null ||
        Number(translation.rows[0].owner_id) !== userId
      ) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Translation not found" });
        return;
      }
      const existing = await client.query(
        "SELECT option_id, translation_id, idx, text, created_at " +
        "FROM other_option WHERE translation_id = $1 AND text = $2 ORDER BY idx LIMIT 1",
        [translationId, text],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        res.json({ option: existing.rows[0], existing: true });
        return;
      }
      const count = await client.query(
        "SELECT COUNT(*)::int AS count, COALESCE(MAX(idx), 0)::int AS max_idx " +
        "FROM other_option WHERE translation_id = $1",
        [translationId],
      );
      if ((count.rows[0]?.count ?? 0) >= 230) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Other-option limit reached (230)" });
        return;
      }
      const result = await client.query(
        "INSERT INTO other_option (translation_id, idx, text) " +
        "VALUES ($1, $2, $3) " +
        "RETURNING option_id, translation_id, idx, text, created_at",
        [translationId, Number(count.rows[0]?.max_idx ?? 0) + 1, text],
      );
      await client.query(
        "UPDATE translation SET updated_at = CURRENT_TIMESTAMP WHERE translation_id = $1",
        [translationId],
      );
      await client.query("COMMIT");
      res.status(201).json({ option: result.rows[0], existing: false });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      reqError(res, error);
    } finally {
      client?.release();
    }
  },
);

export default router;
