const pool = require("../config/db");
const getGithubToken = require("../services/helper");
const jwt = require("jsonwebtoken");

const downloadController = async (req, res) => {
  const decoded = req.user;
  const { filename } = req.query;

  try {
    const fileResult = await pool.query(
      `SELECT file_name, file_size FROM files WHERE file_name = $1 AND github_username = $2`,
      [filename, decoded.username],
    );
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const chunksResult = await pool.query(
      `SELECT chunk_index, directory_path , repo FROM chunks 
       WHERE file_name = $1 AND github_username = $2 
       ORDER BY chunk_index ASC`,
      [filename, decoded.username],
    );

    const githubToken = await getGithubToken(decoded.installationId);

    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Type", "application/octet-stream");
    //res.setHeader("Content-Length", fileResult.rows[0].file_size);
    res.setHeader("X-File-Size", fileResult.rows[0].file_size); // ✅ custom header
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-File-Size, Content-Length",
    ); // ✅ CORS ke liye zaroori

    const BATCH_SIZE = 2;
    const chunks = chunksResult.rows;
    console.log(chunks);
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // ✅ Batch parallel fetch
      const fetchedBatch = await Promise.all(
        batch.map(async (chunk) => {
          const response = await fetch(
            `https://api.github.com/repos/${decoded.username}/${chunk.repo}/contents/${chunk.directory_path}`,
            { headers: { Authorization: `Bearer ${githubToken}` } },
          );
          const data = await response.json();

          const rawResponse = await fetch(data.download_url, {
            headers: { Authorization: `Bearer ${githubToken}` },
          });
          const arrayBuffer = await rawResponse.arrayBuffer();
          return { index: chunk.chunk_index, buffer: Buffer.from(arrayBuffer) };
        }),
      );

      // ✅ Order mein sort karke write karo
      fetchedBatch
        .sort((a, b) => a.index - b.index)
        .forEach((chunk) => {
          res.write(chunk.buffer);
          console.log(`Chunk ${chunk.index} sent`);
        });
    }

    res.end();
    console.log("Download complete:", filename);
  } catch (err) {
    console.error("Download error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};

module.exports = downloadController;
