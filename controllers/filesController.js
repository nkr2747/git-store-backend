const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const filesController = async (req, res) => {
  const decoded = req.user;
  try {
    const result = await pool.query(
      `SELECT file_name, file_size, uploaded_at 
       FROM files 
       WHERE github_username = $1
       ORDER BY uploaded_at DESC
      `,
      [decoded.username],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = filesController;
