import app from "./bundle.js";

export default async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Rewrite /api/health to /health for the Hono app's routing
    if (url.pathname === "/api/health") {
      url.pathname = "/health";
    }

    const request = new Request(url, {
      method: req.method,
      headers: new Headers(req.headers),
    });

    const response = await app.fetch(request);
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      res.setHeader(key, value);
    }
    const body = await response.text();
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
};
