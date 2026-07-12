const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const getGithubToken = require("../services/helper");

const deleteController = async (req, res) => {
  const decoded = req.user;
  const { filename } = req.query;

  try {
    // Step 1 - Chunks ke paths lo GitHub se delete karne ke liye
    const chunksResult = await pool.query(
      `SELECT directory_path FROM chunks 
       WHERE file_name = $1 AND github_username = $2`,
      [filename, decoded.username],
    );

    if (chunksResult.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const githubToken = await getGithubToken(decoded.installationId);

    // Step 2 - Current tree SHA lo
    const refResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/refs/heads/main`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
    const refData = await refResponse.json();
    const latestCommitSha = refData.object.sha;

    const commitResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/commits/${latestCommitSha}`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
    const commitData = await commitResponse.json();
    const baseTreeSha = commitData.tree.sha;

    // Step 3 - Delete tree banao (sha: null = delete)
    const tree = chunksResult.rows.map((chunk) => ({
      path: chunk.directory_path,
      mode: "100644",
      type: "blob",
      sha: null, // ✅ null matlab delete
    }));

    const treeResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/trees`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tree, base_tree: baseTreeSha }),
      },
    );
    const treeData = await treeResponse.json();

    // Step 4 - Ek commit mein saare chunks delete
    const commitRes = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/commits`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Delete ${filename}`,
          tree: treeData.sha,
          parents: [latestCommitSha],
        }),
      },
    );
    const commitResult = await commitRes.json();

    // Step 5 - Ref update karo
    await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/refs/heads/main`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sha: commitResult.sha }),
      },
    );

    // Step 6 - DB se delete karo
    await pool.query(
      `DELETE FROM files WHERE file_name = $1 AND github_username = $2`,
      [filename, decoded.username],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = deleteController;
