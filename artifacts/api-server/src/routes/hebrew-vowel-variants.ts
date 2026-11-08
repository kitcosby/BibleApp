import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { logger } from "../lib/logger";
import { hebrewVariantPool } from "../lib/hebrew-variant-db";

const router: IRouter = Router();
const EXPECTED = {
  algorithmVersion: "nfc-remove-u05b0-u05bb-u05c7-v1",
  normalizationForm: "NFC",
  sourceSnapshotId: "sha256:2ea0a1b12a4335d11393c1baddd1d0e0327f67f70059973f82f52c9bb557a540",
  groups: 3349, members: 7148, uniqueMemberKeys: 7145, occurrences: 32676,
} as const;
const RELATION = "vowel-only-orthographic-variant";
const INTERPRETIVE_LIMIT = "Orthographic relation only; lexical identity, morphology equivalence, and meaning are not adjudicated.";

function requireSandboxToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.BIBLE_APP_SANDBOX_TOKEN;
  const supplied = req.header("x-sandbox-token");
  if (!expected || !supplied) {
    res.status(403).json({ error: "Sandbox authorization required" });
    return;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(403).json({ error: "Sandbox authorization required" });
    return;
  }
  next();
}
router.use(requireSandboxToken);

function positiveSafeInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function safeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Unsafe database integer");
  return parsed;
}
function language(isAramaic: boolean): "hebrew" | "aramaic" {
  return isAramaic ? "aramaic" : "hebrew";
}
function isAramaicValue(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new Error("Unexpected source language flag");
}
type CursorPayload = {
  groupId: number;
  rootId: number;
  rootFormSeq: number;
  vowelSeq: number;
  lastWordId: number;
};
function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodeCursor(value: unknown): CursorPayload | null | "invalid" {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) return "invalid";
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const groupId = positiveSafeInteger(String(parsed.groupId));
    const rootId = positiveSafeInteger(String(parsed.rootId));
    const rootFormSeq = positiveSafeInteger(String(parsed.rootFormSeq));
    const vowelSeq = positiveSafeInteger(String(parsed.vowelSeq));
    const lastWordId = positiveSafeInteger(String(parsed.lastWordId));
    if (!groupId || !rootId || !rootFormSeq || !vowelSeq || !lastWordId) return "invalid";
    return { groupId, rootId, rootFormSeq, vowelSeq, lastWordId };
  } catch {
    return "invalid";
  }
}
function datasetFields(row: QueryResultRow) {
  return {
    algorithmVersion: row.algorithm_version,
    normalizationForm: row.normalization_form,
    sourceSnapshotId: row.source_snapshot_id,
    validation: "runtime-invariants-passed" as const,
  };
}

let validationPromise: Promise<void> | undefined;
let validationExpiresAt = 0;
async function ensureValidatedSnapshot(): Promise<void> {
  if (!hebrewVariantPool) throw new Error("Variant database is not configured");
  if (validationPromise && Date.now() < validationExpiresAt) return validationPromise;
  validationExpiresAt = Date.now() + 30_000;
  validationPromise = (async () => {
    const result = await hebrewVariantPool.query(
      `SELECT
        (SELECT count(*)::int FROM hebrew_vowel_variant_group) AS groups,
        (SELECT count(*)::int FROM hebrew_vowel_variant_member) AS members,
        (SELECT count(DISTINCT (root_id, root_form_seq, vowel_seq))::int FROM hebrew_vowel_variant_member) AS unique_member_keys,
        (SELECT count(*)::int FROM words w WHERE EXISTS (
          SELECT 1 FROM hebrew_vowel_variant_member m
          WHERE m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq
            AND m.vowel_seq=w.root_vowel_seq AND m.is_aramaic=(w.is_aramaic=1)
        )) AS occurrences,
        (SELECT count(*)::int FROM hebrew_vowel_variant_group g
          WHERE g.algorithm_version<>$1 OR g.normalization_form<>$2
            OR g.source_snapshot_id<>$3 OR g.review_status<>'candidate') AS invalid_groups,
        (SELECT count(*)::int FROM hebrew_vowel_variant_member m
          JOIN hebrew_vowel_variant_group g USING(variant_group_id)
          WHERE m.is_aramaic<>g.is_aramaic OR m.algorithm_version<>g.algorithm_version
            OR m.source_snapshot_id<>g.source_snapshot_id) AS member_metadata_mismatches,
        (SELECT count(*)::int FROM hebrew_vowel_variant_member m
          LEFT JOIN root_vowel rv ON rv.root_id=m.root_id AND rv.root_form_seq=m.root_form_seq AND rv.vowel_seq=m.vowel_seq
          WHERE rv.root_id IS NULL) AS missing_vowel_parents,
        (SELECT count(*)::int FROM hebrew_vowel_variant_member m
          LEFT JOIN root_entry re ON re.root_id=m.root_id
          LEFT JOIN root_form rf ON rf.root_id=m.root_id AND rf.form_seq=m.root_form_seq
          WHERE re.root_id IS NULL OR rf.root_id IS NULL) AS missing_lexical_parents,
        (SELECT count(*)::int FROM (
          SELECT root_id,root_form_seq,vowel_seq,is_aramaic FROM hebrew_vowel_variant_member
          GROUP BY root_id,root_form_seq,vowel_seq,is_aramaic
          HAVING count(DISTINCT variant_group_id)>1
        ) d) AS multiply_assigned_members,
        (SELECT count(*)::int FROM (
          SELECT g.variant_group_id FROM hebrew_vowel_variant_group g
          LEFT JOIN hebrew_vowel_variant_member m USING(variant_group_id)
          LEFT JOIN root_vowel rv ON rv.root_id=m.root_id AND rv.root_form_seq=m.root_form_seq AND rv.vowel_seq=m.vowel_seq
          GROUP BY g.variant_group_id
          HAVING count(DISTINCT normalize(rv.vowel_pattern,NFC))<2
        ) d) AS groups_without_two_forms,
        (SELECT count(*)::int FROM words WHERE is_aramaic NOT IN (0,1)) AS invalid_language_flags`,
      [EXPECTED.algorithmVersion, EXPECTED.normalizationForm, EXPECTED.sourceSnapshotId],
    );
    const row = result.rows[0] as QueryResultRow;
    const checks: Record<string, number> = {
      groups: EXPECTED.groups, members: EXPECTED.members,
      unique_member_keys: EXPECTED.uniqueMemberKeys, occurrences: EXPECTED.occurrences,
      invalid_groups: 0, member_metadata_mismatches: 0, missing_vowel_parents: 0,
      missing_lexical_parents: 0, multiply_assigned_members: 0,
      groups_without_two_forms: 0, invalid_language_flags: 0,
    };
    for (const [key, expected] of Object.entries(checks)) {
      if (safeNumber(row[key]) !== expected) throw new Error(`Shadow snapshot invariant failed: \${key}`);
    }
  })();
  try {
    await validationPromise;
  } catch (error) {
    validationPromise = undefined;
    validationExpiresAt = 0;
    throw error;
  }
}
function databaseFailure(res: Response, error: unknown) {
  logger.error({ err: error }, "Hebrew vowel-variant request failed");
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : "";
  const unavailable =
    message.startsWith("Shadow snapshot invariant failed") ||
    /^(08|ECONN|57P0|57014)/.test(code);
  res.status(unavailable ? 503 : 500).json({
    error: unavailable ? "Variant data temporarily unavailable" : "Variant request failed",
  });
}

router.get("/by-word/:wordId", async (req, res) => {
  const wordId = positiveSafeInteger(req.params.wordId);
  if (wordId === null) { res.status(400).json({ error: "Invalid wordId" }); return; }
  if (!hebrewVariantPool) { res.status(503).json({ error: "Variant data temporarily unavailable" }); return; }
  try {
    await ensureValidatedSnapshot();
    const result = await hebrewVariantPool.query(
      `SELECT DISTINCT w.word_id::text AS word_id, g.variant_group_id::text AS variant_group_id,
        g.is_aramaic,g.algorithm_version,g.normalization_form,g.source_snapshot_id
       FROM words w
       LEFT JOIN hebrew_vowel_variant_member m
         ON m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq
        AND m.vowel_seq=w.root_vowel_seq AND m.is_aramaic=(w.is_aramaic=1)
       LEFT JOIN hebrew_vowel_variant_group g
         ON g.variant_group_id=m.variant_group_id AND g.review_status='candidate'
       WHERE w.word_id=$1`,
      [wordId],
    );
    if (result.rowCount === 0) { res.status(404).json({ error: "Source word not found" }); return; }
    const groups = result.rows.filter((row) => row.variant_group_id !== null);
    if (groups.length > 1) throw new Error("Source word resolves to multiple groups");
    if (groups.length === 0) { res.json({ group: null }); return; }
    const row = groups[0];
    res.json({ group: {
      id: safeNumber(row.variant_group_id),
      language: language(isAramaicValue(row.is_aramaic)),
      relation: RELATION, dataset: datasetFields(row),
    }});
  } catch (error) { databaseFailure(res, error); }
});

router.get("/:variantGroupId/members/:rootId/:rootFormSeq/:vowelSeq/occurrences", async (req, res) => {
  const groupId=positiveSafeInteger(req.params.variantGroupId);
  const rootId=positiveSafeInteger(req.params.rootId);
  const rootFormSeq=positiveSafeInteger(req.params.rootFormSeq);
  const vowelSeq=positiveSafeInteger(req.params.vowelSeq);
  if (groupId===null || rootId===null || rootFormSeq===null || vowelSeq===null) {
    res.status(400).json({error:"Invalid group or member identifier"}); return;
  }
  let limit=50;
  if (req.query.limit!==undefined) {
    if (typeof req.query.limit!=="string" || !/^\d+$/.test(req.query.limit)) {
      res.status(400).json({error:"Invalid limit"}); return;
    }
    limit=Number(req.query.limit);
    if (!Number.isSafeInteger(limit)||limit<1||limit>100) {
      res.status(400).json({error:"limit must be between 1 and 100"}); return;
    }
  }
  const cursor=decodeCursor(req.query.cursor);
  if (cursor==="invalid" || (cursor && (
    cursor.groupId!==groupId || cursor.rootId!==rootId ||
    cursor.rootFormSeq!==rootFormSeq || cursor.vowelSeq!==vowelSeq
  ))) {res.status(400).json({error:"Invalid cursor"});return;}
  if (!hebrewVariantPool) {res.status(503).json({error:"Variant data temporarily unavailable"});return;}
  try {
    await ensureValidatedSnapshot();
    const member=await hebrewVariantPool.query(
      `SELECT g.is_aramaic,g.algorithm_version,g.normalization_form,g.source_snapshot_id FROM hebrew_vowel_variant_group g
       JOIN hebrew_vowel_variant_member m USING(variant_group_id)
       WHERE g.variant_group_id=$1 AND g.review_status='candidate'
         AND m.root_id=$2 AND m.root_form_seq=$3 AND m.vowel_seq=$4`,
      [groupId,rootId,rootFormSeq,vowelSeq],
    );
    if (member.rowCount===0) {res.status(404).json({error:"Variant group or member not found"});return;}
    const isAramaic=isAramaicValue(member.rows[0].is_aramaic);
    const result=await hebrewVariantPool.query(
      `SELECT w.word_id::text AS word_id,w.word_pos,w.pointed,w.unpointed,w.strongs,w.is_aramaic,
        mp.pattern_id::text AS morphology_id,mp.pattern AS morphology_pattern,mp.language AS morphology_language,
        b.name_en AS book,b.name_he AS book_he,v.chapter,v.verse
       FROM words w JOIN verses v ON v.verse_id=w.verse_id
       JOIN books b ON b.book_id=v.book_id
       LEFT JOIN morph_patterns mp ON mp.pattern_id=w.morph_pattern_id
       WHERE w.root_id=$1 AND w.root_form_seq=$2 AND w.root_vowel_seq=$3
         AND w.is_aramaic=$4 AND w.word_id>$5
       ORDER BY w.word_id LIMIT $6`,
      [rootId,rootFormSeq,vowelSeq,isAramaic?1:0,cursor?.lastWordId??0,limit+1],
    );
    const hasMore=result.rows.length>limit;
    const page=hasMore?result.rows.slice(0,limit):result.rows;
    const occurrences=page.map((row)=>({
      wordId:safeNumber(row.word_id),
      verse:{book:row.book,bookHebrew:row.book_he,chapter:safeNumber(row.chapter),verse:safeNumber(row.verse)},
      wordPosition:safeNumber(row.word_pos),pointed:row.pointed,unpointed:row.unpointed,
      language:language(isAramaicValue(row.is_aramaic)),strongs:row.strongs,
      morphology:row.morphology_id===null?null:{
        id:safeNumber(row.morphology_id),pattern:row.morphology_pattern,language:row.morphology_language,
      },
    }));
    const last=page.at(-1);
    res.json({groupId,memberKey:{rootId,rootFormSeq,vowelSeq},language:language(isAramaic),
      dataset:datasetFields(member.rows[0]),
      limit,occurrences,nextCursor:hasMore&&last?encodeCursor({groupId,rootId,rootFormSeq,vowelSeq,lastWordId:safeNumber(last.word_id)}):null});
  } catch(error) {databaseFailure(res,error);}
});

router.get("/:variantGroupId", async (req,res)=>{
  const groupId=positiveSafeInteger(req.params.variantGroupId);
  if(groupId===null){res.status(400).json({error:"Invalid variantGroupId"});return;}
  if(!hebrewVariantPool){res.status(503).json({error:"Variant data temporarily unavailable"});return;}
  try{
    await ensureValidatedSnapshot();
    const result=await hebrewVariantPool.query(
      `SELECT g.variant_group_id::text AS variant_group_id,g.is_aramaic,g.algorithm_version,
        g.normalization_form,g.source_snapshot_id,m.root_id::text AS root_id,
        m.root_form_seq::text AS root_form_seq,m.vowel_seq::text AS vowel_seq,
        rv.vowel_pattern AS pointed_form,re.root,
        rf.prefix1,rf.prefix2,rf.prefix3,rf.suffix1,rf.suffix2,
        rf.prefix1_disp,rf.prefix2_disp,rf.prefix3_disp,rf.suffix1_disp,rf.suffix2_disp,
        (SELECT count(*)::int FROM words w
          WHERE w.root_id=m.root_id AND w.root_form_seq=m.root_form_seq
            AND w.root_vowel_seq=m.vowel_seq
            AND w.is_aramaic=CASE WHEN m.is_aramaic THEN 1 ELSE 0 END) AS occurrence_count
       FROM hebrew_vowel_variant_group g
       JOIN hebrew_vowel_variant_member m USING(variant_group_id)
       JOIN root_vowel rv ON rv.root_id=m.root_id AND rv.root_form_seq=m.root_form_seq AND rv.vowel_seq=m.vowel_seq
       JOIN root_entry re ON re.root_id=m.root_id
       JOIN root_form rf ON rf.root_id=m.root_id AND rf.form_seq=m.root_form_seq
       WHERE g.variant_group_id=$1 AND g.review_status='candidate'
       ORDER BY m.root_id,m.root_form_seq,m.vowel_seq`,
      [groupId],
    );
    if(result.rowCount===0){res.status(404).json({error:"Variant group not found"});return;}
    const first=result.rows[0];
    const isAramaic=isAramaicValue(first.is_aramaic);
    res.json({group:{
      id:groupId,language:language(isAramaic),relation:RELATION,dataset:datasetFields(first),
      members:result.rows.map((row)=>({
        memberKey:{rootId:safeNumber(row.root_id),rootFormSeq:safeNumber(row.root_form_seq),vowelSeq:safeNumber(row.vowel_seq)},
        pointedForm:row.pointed_form,root:row.root,
        rootForm:{
          prefix1:row.prefix1,prefix2:row.prefix2,prefix3:row.prefix3,
          suffix1:row.suffix1,suffix2:row.suffix2,
          prefix1Display:row.prefix1_disp,prefix2Display:row.prefix2_disp,prefix3Display:row.prefix3_disp,
          suffix1Display:row.suffix1_disp,suffix2Display:row.suffix2_disp,
        },
        occurrenceCount:safeNumber(row.occurrence_count),
      })),
      interpretiveLimit:INTERPRETIVE_LIMIT,
    }});
  }catch(error){databaseFailure(res,error);}
});

export default router;