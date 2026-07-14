async function ensureRepoExists(owner, repoName, githubToken) {
  console.log("Owner: ",owner, "repoName: ", repoName, "githubToken:", githubToken)
  const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
    headers: { Authorization: `Bearer ${githubToken}` },
  });
  console.log("CheckRes: ")
  console.log(checkRes);
  if (checkRes.status === 200) return; // already exists

  if (checkRes.status !== 404) {
    const errData = await checkRes.json();
    throw new Error(`Failed to check repo: ${errData.message || checkRes.status}`);
  }

  const createRes = await fetch(`https://api.github.com/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: repoName,
      private: true,
      auto_init: true, // creates an initial commit + main branch — required, since your commit flow reads refs/heads/main
    }),
  });

  if (createRes.status === 201) return;

  // race: another concurrent request already created it — treat as success
  if (createRes.status === 422) {
    const errData = await createRes.json();
    const alreadyExists = errData.errors?.some((e) => e.message?.includes("already exists"));
    if (alreadyExists) return;
  }

  const errData = await createRes.json();
  throw new Error(`Failed to create repo: ${errData.message || createRes.status}`);
}

module.exports = ensureRepoExists;