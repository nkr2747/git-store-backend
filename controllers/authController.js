const authController = (req, res) => {
  // sirf OAuth — hamesha yahi rahega
  console.log("Redirecting to GitHub for authentication...");
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.BACKEND_URL}/auth/github/callback`,
  );
}
module.exports = authController;