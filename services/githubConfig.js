// services/githubConfig.js
const CONFIG_REPO = "saving_repo_1";
const CONFIG_PATH = "config.json";

async function fetchConfigFile(owner, githubToken) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${CONFIG_REPO}/contents/${CONFIG_PATH}`,
    { headers: { Authorization: `Bearer ${githubToken}` } }
  );

  if (res.status === 404) return null; // doesn't exist yet

  if (!res.ok) {
    const err = await res.json();
    const error = new Error(err.message || `Failed to fetch config: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { content, sha: data.sha }; // sha needed for the next write
}

async function writeConfigFile(owner, githubToken, content, sha) {
  const body = {
    message: sha ? "Update config.json" : "Create config.json",
    content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
  };
  if (sha) body.sha = sha; // omit on create, required on update

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${CONFIG_REPO}/contents/${CONFIG_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    const error = new Error(err.message || `Failed to write config: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  return data.content.sha;
}

module.exports = { fetchConfigFile, writeConfigFile, CONFIG_REPO };