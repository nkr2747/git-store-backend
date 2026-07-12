// ✅ baseTreeSha bahar se aata hai — andar fetch nahi hota
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
    }
  );
}

module.exports = updateRef