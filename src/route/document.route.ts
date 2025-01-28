import express from "express";
import {
  uploadDocument,
  getDocuments,
} from "../controllers/document.controller.js";
import { upload } from "../config/multer.js";

const router = express.Router();

router.post("/", upload.single("file"), uploadDocument);
router.get("/", getDocuments);

export default router;
