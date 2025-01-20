import session from "express-session";

const sessionConfig = session({
  secret: process.env.SESSION_SECRET || "mysecret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: "auto",
    httpOnly: true,
    sameSite: "lax",
  },
});

export default sessionConfig;
