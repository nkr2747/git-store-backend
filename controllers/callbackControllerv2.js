const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const ensureRepoExists = require("../services/ensureRepoExists")
const  {CONFIG_REPO } = require("../services/githubConfig")

const callbackController = async (req, res) => {
  console.log("QUERY:", req.query);
  const code = req.query.code;

  console.log("GitHub callback received with code:", code);
  //console.log("Installation ID (if any):", installationId);
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
  console.log(githubUser)
  // ✅ installations check karo
  const installationResponse = await fetch(
    `https://api.github.com/user/installations`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  const installationData = await installationResponse.json();
  console.log("Installation Data:", installationData);
   const githubUsername = githubUser.login; // GitHub se mila username
  const finalInstallationId = installationData.installations.find(
  (installation) =>
    installation.account.login === githubUsername &&
    installation.app_slug === "nkrstorage"
)?.id;

if (!finalInstallationId) {
  console.log("App not installed");
  return res.redirect(
    "https://github.com/apps/nkrstorage/installations/new"
  );
}


  // if (!finalInstallationId) {
  //   // ✅ install nahi — backend se hi install page pe bhejo
  //   return res.redirect(`https://github.com/apps/nkrstorage/installations/new`);
  //   // install hone ke baad GitHub wapas callback pe aayega
  //   // tab installation_id milega query mein
  // }
 
  try{  
    await ensureRepoExists(githubUsername, CONFIG_REPO, accessToken)
  }catch(err){
    console.error("Unable to ensure CONFIG_REPO: ",err.message);

  }
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
      avatarURL: githubUser.avatar_url,
    },
    process.env.JWT_SECRET,
    { expiresIn: "3h" },
  );

  res.redirect(`${process.env.VITE_FRONTEND_URL}/?token=${jwtToken}`);
};

module.exports = callbackController;
