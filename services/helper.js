const { createAppAuth } = require("@octokit/auth-app");
const privateKey = process.env.GITHUB_PRIVATE_KEY;
async function getGithubToken(installationId) {
  const auth = createAppAuth({
    appId: process.env.APP_ID,
    privateKey: privateKey,
    installationId: installationId,
  });
  const installationAuth = await auth({ type: "installation" });
  return installationAuth.token;
}

module.exports = getGithubToken;