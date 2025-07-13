import session from "express-session";

const sessionConfig = session({
  secret: process.env.SESSION_SECRET || "mysecret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    domain: process.env.NODE_ENV === "production" ? ".brainion.xyz" : undefined, // Key fix!
  },
});

export default sessionConfig;