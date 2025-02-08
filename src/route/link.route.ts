import express from "express"
import { createLink } from "../controllers/link.controller.js";

const router = express.Router();

router.get("/", createLink)

export default router;
