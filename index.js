const express = require("express");
const cors = require("cors");
const app = express();
const port = 3000;
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { createAppAuth } = require("@octokit/auth-app");
const fs = require("fs");
const pool = require("./db");
const { blob } = require("stream/consumers");

//const privateKey = fs.readFileSync("./private-key.pem", "utf8");
const privateKey = process.env.GITHUB_PRIVATE_KEY;
//console.log(temp);
//console.log(privateKey === temp); // true aana chahiye
//console.log(privateKey);

async function getGithubToken(installationId) {
  const auth = createAppAuth({
    appId: process.env.APP_ID,
    privateKey: privateKey,
    installationId: installationId,
  });

  const installationAuth = await auth({ type: "installation" });
  return installationAuth.token;
}
app.use(
  cors({
    origin: "http://localhost:5173", // frontend ka URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
  }),
);
app.use(express.json()); // ✅ ye add karo cors ke baad
app.get("/auth/github", (req, res) => {
  // sirf OAuth — hamesha yahi rahega
  console.log("Redirecting to GitHub for authentication...");
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}`,
  );
});

app.get("/auth/github/callback", async (req, res) => {
  const code = req.query.code;
  const installationId = req.query.installation_id; // agar install page se aaya to milega
  
  // access token lo
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code: code,
      }),
    },
  );
  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  // user info lo
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const githubUser = await userResponse.json();

  // ✅ installations check karo
  const installationResponse = await fetch(
    "https://api.github.com/user/installations",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  const installationData = await installationResponse.json();
  const finalInstallationId =
    installationId || installationData.installations[0]?.id;

  if (!finalInstallationId) {
    // ✅ install nahi — backend se hi install page pe bhejo
    return res.redirect(`https://github.com/apps/nkrstorage/installations/new`);
    // install hone ke baad GitHub wapas callback pe aayega
    // tab installation_id milega query mein
  }
  const githubUsername = githubUser.login; // GitHub se mila username

  await pool.query(
    `INSERT INTO users (github_username)
     VALUES ($1)
     ON CONFLICT (github_username) DO NOTHING`,
    [githubUsername],
  );
  // ✅ install hai — JWT banao
  const jwtToken = jwt.sign(
    {
      userId: githubUser.id,
      username: githubUser.login,
      installationId: finalInstallationId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "3h" },
  );

  res.redirect(`http://localhost:5173/?token=${jwtToken}`);
});

// Step 1 - Har chunk ka blob banao (ye parallel ho sakta hai ✅)
async function createBlob(owner, repo, chunk, githubToken) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: chunk.toString("base64"),
        encoding: "base64",
      }),
    },
  );
  const data = await response.json();
  return data.sha; // blob SHA
}

// Step 2 - Ek saath tree banao
async function createTree(owner, repo, githubToken, blobShas, filename) {
  const tree = blobShas.map((sha, index) => ({
    path: `${filename}/chunk_${index}`,
    mode: "100644",
    type: "blob",
    sha: sha,
  }));

  // ✅ pehle current tree SHA lo
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
    { headers: { Authorization: `Bearer ${githubToken}` } },
  );
  const refData = await refResponse.json();
  const latestCommitSha = refData.object.sha;

  // ✅ us commit ka tree SHA lo
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    { headers: { Authorization: `Bearer ${githubToken}` } },
  );
  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tree,
        base_tree: baseTreeSha, // ✅ yahi missing tha — purane files preserve honge
      }),
    },
  );
  const data = await response.json();
  return data.sha;
}

// Step 3 - Commit banao
async function createCommit(owner, repo, githubToken, treeSha, parentSha) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Upload file chunks",
        tree: treeSha,
        parents: [parentSha],
      }),
    },
  );
  const data = await response.json();
  return data.sha; // commit SHA
}

// Step 4 - Ref update karo
async function updateRef(owner, repo, githubToken, commitSha) {
  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: commitSha }),
    },
  );
}

app.post("/upload", async (req, res) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const filename = req.query.filename;
  const index = parseInt(req.query.index);
  const isLast = req.query.isLast === "true"; // last chunk hai?

  let githubToken;
  try {
    githubToken = await getGithubToken(decoded.installationId);
  } catch (error) {
    return res.status(500).json({ message: "Failed to get GitHub token" });
  }

  // chunk collect karo
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));

  req.on("end", async () => {
    try {
      const completeChunk = Buffer.concat(chunks);

      // ✅ blob banao — ye parallel safe hai
      const blobSha = await createBlob(
        decoded.username,
        "saving_repo1",
        completeChunk,
        githubToken,
      );

      //console.log(`Chunk ${index} blob created: ${blobSha}`);
      res.json({ success: true, index, blobSha });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  req.on("error", (err) => res.status(500).json({ error: err.message }));
});

// ✅ Alag route — jab sab blobs ready ho jaayein tab commit karo
app.post("/commit", async (req, res) => {
  let decoded;
  try {
    decoded = jwt.verify(
      req.headers.authorization.split(" ")[1],
      process.env.JWT_SECRET,
    );
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  const { filename, blobShas, fileSize } = req.body; // [{index: 0, sha: "..."}, ...]

  let githubToken;
  try {
    githubToken = await getGithubToken(decoded.installationId);
  } catch {
    return res.status(500).json({ message: "Failed to get GitHub token" });
  }

  try {
    // sort karo index ke hisaab se
    const sortedBlobs = blobShas.sort((a, b) => a.index - b.index);

    // current HEAD SHA lo
    const refResponse = await fetch(
      `https://api.github.com/repos/${decoded.username}/saving_repo1/git/refs/heads/main`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
    const refData = await refResponse.json();
    const parentSha = refData.object.sha;

    // tree banao
    const treeSha = await createTree(
      decoded.username,
      "saving_repo1",
      githubToken,
      sortedBlobs.map((b) => b.sha),
      filename,
    );

    // commit karo
    const commitSha = await createCommit(
      decoded.username,
      "saving_repo1",
      githubToken,
      treeSha,
      parentSha,
    );

    // ref update karo
    await updateRef(decoded.username, "saving_repo1", githubToken, commitSha);
    // ✅ Chunks DB mein save karo
    //console.log(filename,decoded.username,blob.index,`${filename}/chunk_${blob.index}`);
    // ✅ File metadata save karo
    await pool.query(
      `INSERT INTO files (file_name, github_username, file_size)
   VALUES ($1, $2, $3)`,
      [filename, decoded.username, fileSize], // fileSize frontend se bhejo
    );
    for (const blob of sortedBlobs) {
      //console.log(filename,decoded.username,blob.index,`${filename}/chunk_${blob.index}`);
      await pool.query(
        `INSERT INTO chunks (file_name, github_username, chunk_index, directory_path)
     VALUES ($1, $2, $3, $4)`,
        [
          filename,
          decoded.username,
          blob.index,
          `${filename}/chunk_${blob.index}`, // GitHub path
        ],
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Commit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/files", async (req, res) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const result = await pool.query(
      `SELECT file_name, file_size, uploaded_at 
       FROM files 
       WHERE github_username = $1
       ORDER BY uploaded_at DESC
       LIMIT 1`,
      [decoded.username],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/download", async (req, res) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

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
      `SELECT chunk_index, directory_path FROM chunks 
       WHERE file_name = $1 AND github_username = $2 
       ORDER BY chunk_index ASC`,
      [filename, decoded.username],
    );

    const githubToken = await getGithubToken(decoded.installationId);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", fileResult.rows[0].file_size);

    const BATCH_SIZE = 4;
    const chunks = chunksResult.rows;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // ✅ Batch parallel fetch
      const fetchedBatch = await Promise.all(
        batch.map(async (chunk) => {
          const response = await fetch(
            `https://api.github.com/repos/${decoded.username}/saving_repo1/contents/${chunk.directory_path}`,
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
});

app.delete("/delete", async (req, res) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

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
});

// app.get("/repo", async (req, res) => {
//   let decoded;
//   try {
//     const authHeader = req.headers.authorization;
//     if (!authHeader)
//       return res.status(401).json({ message: "No token provided" });
//     decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
//   } catch {
//     return res.status(401).json({ message: "Invalid token" });
//   }

//   // Fetch repository information
//   const minRepo = pool.query(
//     `SELECT repo_name
//     FROM repositories
//     WHERE github_username = $1
//     ORDER BY size ASC
//     limit 1`,
//     [decoded.username],
//   );
//   const repoName = `saving_repo1`; // ✅ hardcoded repo name
//   )
// });

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
