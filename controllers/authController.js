const authController = (req, res) => {
  // sirf OAuth — hamesha yahi rahega
  console.log("Redirecting to GitHub for authentication...");
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}`,
  );
}
module.exports = authController;