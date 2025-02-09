import express from "express"
import { createLink } from "../controllers/link.controller.js";

const router = express.Router();

router.post("/", createLink)

export default router;
