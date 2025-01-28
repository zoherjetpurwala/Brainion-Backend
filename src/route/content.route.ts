import express from "express"
import { getAllContent } from "../controllers/content.controller.js";

const router = express.Router();

router.get("/", getAllContent)

export default router;