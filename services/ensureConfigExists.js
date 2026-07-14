// services/ensureConfigExists.js
const ensureRepoExists = require("./ensureRepoExists");
const { fetchConfigFile, writeConfigFile, CONFIG_REPO } = require("./githubConfig");

async function ensureConfigExists(owner, githubToken) {
  await ensureRepoExists(owner, CONFIG_REPO, githubToken); // auto_init:true, so main branch already exists

  const existing = await fetchConfigFile(owner, githubToken);
  console.log("Existing: ",existing)
  if (existing) return existing.content;

  const defaultConfig = {
    current_repo: { name: CONFIG_REPO, size: 0 },
    saving_repos: [{ name: CONFIG_REPO, size: 0 }],
  };

  await writeConfigFile(owner, githubToken, defaultConfig, null);
  return defaultConfig;
}

module.exports = ensureConfigExists;