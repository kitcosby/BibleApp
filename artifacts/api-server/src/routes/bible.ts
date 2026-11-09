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
      const result = await client.query(
        "INSERT INTO other_option (translation_id, idx, text) " +
        "SELECT $1, COALESCE(MAX(idx), 0) + 1, $2 " +
        "FROM other_option WHERE translation_id = $1 " +
        "RETURNING option_id, translation_id, idx, text, created_at",
        [translationId, text],
      );
      await client.query(
        "UPDATE translation SET updated_at = CURRENT_TIMESTAMP WHERE translation_id = $1",
        [translationId],
      );
      await client.query("COMMIT");
      res.status(201).json({ option: result.rows[0] });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      reqError(res, error);
    } finally {
      client?.release();
    }
  },
);

export default router;
