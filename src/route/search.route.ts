import express from "express"
import { searchByTitle, searchWithAI } from "../controllers/search.controller.js";

const router = express.Router();

router.post("/ai", searchWithAI)
router.post("/title", searchByTitle)


export default router;
