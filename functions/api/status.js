// Mirrors worker.mjs: the repo carries a key so a deploy works with no secret set.
// Delete this constant and set OPENROUTER_API_KEY to require configuration.
const REPO_API_KEY = "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";

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
