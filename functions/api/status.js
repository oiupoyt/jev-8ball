// Default placeholder API key. Set OPENROUTER_API_KEY in environment or Cloudflare secrets.
const REPO_API_KEY = "your-openrouter-api-key";

export async function onRequestGet(context) {
  const { env } = context;
  return new Response(JSON.stringify({
    status: "online",
    model: "typesafe/jev-1.13",
    engine: "TypeSafe Jev (Cloudflare Pages Edge)",
    hasKey: Boolean(env.OPENROUTER_API_KEY || REPO_API_KEY),
    keySource: env.OPENROUTER_API_KEY ? "env" : "repo"
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
