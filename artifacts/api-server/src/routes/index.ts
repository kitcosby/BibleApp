import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bibleRouter from "./bible";
import hebrewVowelVariantsRouter from "./hebrew-vowel-variants";

const router: IRouter = Router();
router.use(healthRouter);
router.use("/bible", (req, res, next) => {
  const token = process.env.BIBLE_APP_SANDBOX_TOKEN;
  if (!token || req.header("x-sandbox-token") !== token) {
    res.status(403).json({ error: "Sandbox authorization required" });
    return;
  }
  next();
});
router.use(bibleRouter);
router.use("/lexicon/hebrew-vowel-variants", hebrewVowelVariantsRouter);
export default router;