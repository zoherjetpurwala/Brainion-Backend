import express from "express"
import { searchFunction } from "../controllers/search.controller.js";

const router = express.Router();

router.post("/", searchFunction)

export default router;
