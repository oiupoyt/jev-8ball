export async function onRequestGet(context) {
  const { env } = context;
  const hasKey = Boolean(env.OPENROUTER_API_KEY || true);
  return new Response(JSON.stringify({
    status: "online",
    model: "typesafe/jev-1.13",
    engine: "TypeSafe Jev (Cloudflare Pages Edge)",
    hasKey
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
