// Localhost-only bridge between the local-model worker and the pipeline's database.
// Exposes the same paths the worker already uses (/api/ai/...), on 127.0.0.1.
import { createServer } from "node:http";
import { pg } from "@/lib/db/client";
import { ArticleResults, pendingArticles, pendingThinkers, saveArticleResults, saveThinkerResults, ThinkerResults } from "@/lib/ai";

const PORT = Number(process.env.AI_BRIDGE_PORT ?? 3999);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    const limit = Number(url.searchParams.get("limit"));
    if (req.method === "GET" && url.pathname === "/api/ai/pending") return send(200, { items: await pendingArticles(limit) });
    if (req.method === "GET" && url.pathname === "/api/ai/thinkers") return send(200, { items: await pendingThinkers(limit) });
    if (req.method === "POST" && (url.pathname === "/api/ai/ingest" || url.pathname === "/api/ai/thinkers")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (url.pathname === "/api/ai/ingest") {
        const p = ArticleResults.safeParse(body);
        return p.success ? send(200, await saveArticleResults(p.data)) : send(400, { error: p.error.message });
      }
      const p = ThinkerResults.safeParse(body);
      return p.success ? send(200, await saveThinkerResults(p.data)) : send(400, { error: p.error.message });
    }
    if (url.pathname === "/api/ai/refresh") return send(200, { skipped: "a coleta roda no próprio pipeline" });
    send(404, { error: "not found" });
  } catch (err) {
    send(500, { error: (err as Error).message });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`ai-bridge em http://127.0.0.1:${PORT}`));
process.on("SIGTERM", () => server.close(() => pg.end()));
