const jwt = require("jsonwebtoken");
const getGithubToken = require("../services/helper");
const createTree = require("../services/createTree");
const pool = require("../config/db");
const createCommit = require("../services/createCommit");
const updateRef = require("../services/updateRef");

const commitController = async (req, res) => {
  const decoded = req.user;
  const { filename, blobShas, fileSize, isLastBatch } = req.body;

  if (!filename || !blobShas || !fileSize)
    return res
      .status(400)
      .json({ message: "filename, blobShas, fileSize required" });

  let githubToken;
  try {
    githubToken = await getGithubToken(decoded.installationId);
  } catch {
    return res.status(500).json({ message: "Failed to get GitHub token" });
  }

  try {
    // index ke hisaab se sort karo
    const sortedBlobs = blobShas.sort((a, b) => a.index - b.index);

    // ✅ current HEAD aur baseTree ek baar lo
    const refResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/refs/heads/main`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
    const refData = await refResponse.json();
    const parentSha = refData.object.sha;

    const commitResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/commits/${parentSha}`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
    const commitData = await commitResponse.json();
    const baseTreeSha = commitData.tree.sha;

    // ✅ tree banao — global index wale paths honge
    const treeSha = await createTree(
      decoded.username,
      "saving_repo1",
      githubToken,
      sortedBlobs, // ✅ {index, sha} objects pass ho rahe hain
      filename,
      baseTreeSha,
    );

    // commit karo
    const commitSha = await createCommit(
      decoded.username,
      "saving_repo1",
      githubToken,
      treeSha,
      parentSha,
      `Upload ${filename} chunks ${sortedBlobs[0].index} to ${sortedBlobs[sortedBlobs.length - 1].index}`,
    );

    // ref update karo
    await updateRef(decoded.username, "saving_repo1", githubToken, commitSha);

    // ✅ DB — transaction use karo
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ✅ sirf last batch mein files table mein insert karo
      if (isLastBatch) {
        await client.query(
          `INSERT INTO files (file_name, github_username, file_size) VALUES ($1, $2, $3)`,
          [filename, decoded.username, fileSize],
        );
      }

      // har batch mein chunks save karo
      for (const blob of sortedBlobs) {
        await client.query(
          `INSERT INTO chunks (file_name, github_username, chunk_index, directory_path) VALUES ($1, $2, $3, $4)`,
          [
            filename,
            decoded.username,
            blob.index,
            `${filename}/chunk_${blob.index}`,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Commit error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = commitController;
