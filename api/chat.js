// Adaptador para a Vercel: reaproveita a função que já existe em netlify/functions/chat.js
const h = require("../netlify/functions/chat.js").handler;

module.exports = async (req, res) => {
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const r = await h({ httpMethod: req.method, body, headers: req.headers });
  res.status(r.statusCode).setHeader("Content-Type", "application/json").send(r.body);
};
