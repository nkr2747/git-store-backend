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
    }
  );
  const data = await response.json();
  return data.sha;
}
module.exports = createBlob