// route/search.route.js
import express from "express";
import { searchByTitle, searchWithAI } from "../controllers/search.controller.js";

const router = express.Router();

// Add logging middleware to debug
router.use((req, res, next) => {
  console.log(`Search route hit: ${req.method} ${req.path}`);
  next();
});

router.post("/ai", searchWithAI);
router.get("/ai", (req, res) => {
  res.status(405).json({ error: "Method not allowed. Use POST instead." });
});
router.post("/title", searchByTitle);

// Test route to verify mounting
router.get("/test", (req, res) => {
  res.json({ message: "Search routes are working!" });
});

export default router;