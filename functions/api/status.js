// Mirrors worker.mjs: the repo carries a key so a deploy works with no secret set.
// Delete this constant and set OPENROUTER_API_KEY to require configuration.
const REPO_API_KEY = "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";

export async function onRequestGet(context) {
  const { env } = context;
  let layaOnline = false;
  let layaData = null;

  const layaUrl = env.LAYA_API_URL || "https://laya-api.oiupoyt.space";
  try {
    const res = await fetch(`${layaUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      layaData = await res.json();
      layaOnline = Boolean(layaData.status === "online" || layaData.ready);
    }
  } catch (e) {}

  return new Response(JSON.stringify({
    status: "online",
    model: layaOnline ? (layaData?.model || "convaiinnovations/laya-typed-decisions") : "typesafe/jev-1.13",
    engine: layaOnline ? "Laya System 1 (Tablet via Tunnel)" : "TypeSafe Jev (Cloudflare Pages Edge)",
    tablet: layaOnline,
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
