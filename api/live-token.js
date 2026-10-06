// Netlify Function: gera um token temporário (1 uso) para o navegador falar com o Gemini Live.
// A chave GEMINI_API_KEY continua só no Netlify, nunca vai para o navegador.

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: "Chave da API não configurada no Netlify." });

  const agora = Date.now();
  const body = {
    uses: 1,
    expireTime: new Date(agora + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(agora + 60 * 1000).toISOString(),
  };

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.name) {
      console.error("Erro ao criar token:", res.status, JSON.stringify(data));
      return json(502, { error: `Não consegui criar a ligação (erro ${res.status}).` });
    }
    return json(200, { token: data.name });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Erro ao criar a ligação." });
  }
};

module.exports = async (req, res) => {
  const r = await handler({ httpMethod: req.method });
  res.status(r.statusCode).setHeader("Content-Type", "application/json").send(r.body);
};
