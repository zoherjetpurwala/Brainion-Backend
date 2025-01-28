import express from "express";
import { createNote, deleteNote } from "../controllers/note.controller.js";

const router = express.Router();

router.post("/", createNote);
router.delete("/:id", deleteNote);

export default router;
