const jwt = require("jsonwebtoken");
const createBlob = require("../services/createBlob")
const getGithubToken = require("../services/helper")



const uploadController = async (req, res) => {
  const decoded = req.user;

  const filename = req.query.filename;
  const index = parseInt(req.query.index);

  if (!filename || isNaN(index))
    return res.status(400).json({ message: "filename aur index required hai" });

  let githubToken;
  try {
    githubToken = await getGithubToken(decoded.installationId);
  } catch (error) {
    return res.status(500).json({ message: "Failed to get GitHub token" });
  }
  let config;
  try{
    config = await ensureConfigExists(decoded.username, githubToken);
  }catch(err){
    return res.status(500).json({ message: "Failed to get GitHub config" });
  }
  const repo = config.current_repo;
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));

  req.on("end", async () => {
    try {
      const completeChunk = Buffer.concat(chunks);
      chunks.length = 0; // ✅ memory clear karne ke liye
      const blobSha = await createBlob(
        decoded.username,
        repo,
        completeChunk,
        githubToken
      );
      res.json({ success: true, index, blobSha , repo});
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  req.on("error", (err) => res.status(500).json({ error: err.message }));
}

module.exports = uploadController;