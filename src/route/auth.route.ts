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
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).send("Unauthorized");
  }
});

export default router;
