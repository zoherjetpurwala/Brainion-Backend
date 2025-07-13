import express from "express"
import { deleteContent, getAllContent } from "../controllers/content.controller.js";

const router = express.Router();

router.get("/", getAllContent)
router.delete("/:id", deleteContent)

export default router;