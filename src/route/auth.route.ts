import { Router } from "express";
import passport from "../config/passport.config.js";

const router = Router();

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect(process.env.CLIENT_URL + "/dashboard");
  }
);

router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error(err);
      res.status(500).send("Error logging out");
    } else {
      res.send("Logged out successfully");
    }
  });
});

router.get("/user", (req, res) => {
  try {
    if (req.isAuthenticated()) {
      res.status(200).json({
        success: true,
        message: "User authenticated",
        user: req.user,
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Unauthorized - User not authenticated",
      });
    }
  } catch (error) {
    console.error("Error in /user endpoint:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching user information",
    });
  }
});

export default router;
