const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { createAppAuth } = require("@octokit/auth-app");
const fs = require("fs");
const pool = require("./config/db");
const { blob } = require("stream/consumers");
const authController = require("./controllers/authController");
const callbackController = require("./controllers/callbackController");
const uploadController = require("./controllers/uploadController");
const downloadController = require("./controllers/downloadController");
const filesController = require("./controllers/filesController");
const deleteController = require("./controllers/deleteController");
const commitController = require("./controllers/commitController");
const auth = require("./middleware/auth")

const privateKey = process.env.GITHUB_PRIVATE_KEY;

app.use(
  cors({
    origin: process.env.VITE_FRONTEND_URL, // frontend ka URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["X-File-Size", "Content-Length"], //  ye add karo
  }),
);
app.use(express.json()); // ✅ ye add karo cors ke baad
app.get("/", (req, res) => {
  res.json({ message: "Server is running" });
});
app.get("/auth/github", authController);

app.get("/auth/github/callback", callbackController);

app.use(auth);

app.post("/upload", uploadController);

//  Alag route — jab sab blobs ready ho jaayein tab commit karo
app.post("/commit", commitController);

app.get("/files", filesController);

app.get("/download", downloadController);

app.delete("/delete", deleteController);

app.listen(port, () => {
  console.log(`Server is running at ${process.env.BACKEND_URL}:${port}`);
});
