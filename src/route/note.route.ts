import express from "express";
import { createNote, getNotes, deleteNote, askQuestion } from "../controllers/note.controller.js";

const router = express.Router();

router.post("/", createNote);
router.get("/", getNotes);
router.patch("/", askQuestion);
router.delete("/:id", deleteNote);

export default router;
