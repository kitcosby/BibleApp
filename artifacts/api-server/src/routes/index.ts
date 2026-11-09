import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bibleRouter from "./bible";
import hebrewVowelVariantsRouter from "./hebrew-vowel-variants";
import { requireUserIdentity } from "../lib/identity";

const router: IRouter = Router();
router.use(healthRouter);

// Private translation metadata and authoring responses must never be cached.
router.use("/bible", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

// All authoring and translation metadata routes require a short-lived,
// Flask-issued per-user identity. The browser never receives the DB sandbox token.
router.use("/bible", requireUserIdentity);
router.use(bibleRouter);

// Hebrew variant reads remain on their separate, server-side sandbox-token
// boundary until a deliberate public-read policy and CORS contract are approved.
router.use("/lexicon/hebrew-vowel-variants", hebrewVowelVariantsRouter);
export default router;
