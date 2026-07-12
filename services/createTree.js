async function createTree(owner, repo, githubToken, blobShas, filename, baseTreeSha) {
  // ✅ blobShas = [{index, sha}] — global index use hoga
  const tree = blobShas.map((blob) => ({
    path: `${filename}/chunk_${blob.index}`, // ✅ global index
    mode: "100644",
    type: "blob",
    sha: blob.sha,
  }));

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tree, base_tree: baseTreeSha }),
    }
  );
  const data = await response.json();
  return data.sha;
}

module.exports = createTree;