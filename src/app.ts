import express, { Response } from "express";
import cors from "cors";
import { rateLimiter } from "./middleware/rateLimiter.middleware.js";
import { securityMiddleware } from "./middleware/security.middleware.js";
import { errorHandler } from "./middleware/errorHandler.middleware.js";
import sessionConfig from "./config/session.config.js";
import passport from "./config/passport.config.js";
import authRoutes from "./route/auth.route.js";
import noteRoutes from "./route/note.route.js";
import documentRoutes from "./route/document.route.js";
import searchRoute from "./route/search.route.js"
import prisma from "./prisma.js";

// Initialize Express app
const app = express();

// CORS Configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Parse incoming JSON payloads
app.use(express.json());

app.set("trust proxy", 1);

// Configure session
app.use(sessionConfig);

// Initialize Passport for authentication
app.use(passport.initialize());
app.use(passport.session());

// Middlewares
app.use(rateLimiter);
app.use(securityMiddleware);
app.use(errorHandler);

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/notes", noteRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/search", searchRoute)

// Basic endpoint to confirm server is running
app.get("/", (_, response: Response) => {
  response.status(200).json({
    message: "Server running successfully!!",
  });
});

// Start the server
app.listen(process.env.PORT, async () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);

  try {
    await prisma.$connect();
    console.log("Database Connected");
  } catch (error: any) {
    console.log("Database Error: " + error.message);
  }
});

export default app;
