import express from "express";
import {
  uploadDocument,
} from "../controllers/document.controller.js";
import { upload } from "../config/multer.js";

const router = express.Router();

router.post("/", upload.single("file"), uploadDocument);

export default router;
