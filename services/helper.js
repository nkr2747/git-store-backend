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