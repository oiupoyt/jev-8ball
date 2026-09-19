const DEFAULT_KEY = "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";
const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";

const APHORISMS = {
  certain: { text: "It is certain.", sentiment: "affirmative" },
  decidedly: { text: "It is decidedly so.", sentiment: "affirmative" },
  without_doubt: { text: "Without a doubt.", sentiment: "affirmative" },
  yes_definitely: { text: "Yes definitely.", sentiment: "affirmative" },
  rely: { text: "You may rely on it.", sentiment: "affirmative" },
  as_i_see_it: { text: "As I see it, yes.", sentiment: "affirmative" },
  most_likely: { text: "Most likely.", sentiment: "affirmative" },
  outlook_good: { text: "Outlook good.", sentiment: "affirmative" },
  yes: { text: "Yes.", sentiment: "affirmative" },
  signs_yes: { text: "Signs point to yes.", sentiment: "affirmative" },

  reply_hazy: { text: "Reply hazy, try again.", sentiment: "neutral" },
  ask_again: { text: "Ask again later.", sentiment: "neutral" },
  better_not: { text: "Better not tell you now.", sentiment: "neutral" },
  cannot_predict: { text: "Cannot predict now.", sentiment: "neutral" },
  concentrate: { text: "Concentrate and ask again.", sentiment: "neutral" },

  dont_count: { text: "Don't count on it.", sentiment: "negative" },
  my_reply_no: { text: "My reply is no.", sentiment: "negative" },
  sources_no: { text: "My sources say no.", sentiment: "negative" },
  outlook_bad: { text: "Outlook not so good.", sentiment: "negative" },
  very_doubtful: { text: "Very doubtful.", sentiment: "negative" }
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.OPENROUTER_API_KEY || DEFAULT_KEY;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON input." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const question = body.question;
  if (!question || typeof question !== "string" || !question.trim()) {
    return new Response(JSON.stringify({ error: "Question is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const cleanQuestion = question.trim().slice(0, 300);
  const startTime = Date.now();

  try {
    const payload = {
      model: MODEL,
      state: { question: cleanQuestion },
      questions: {
        favorable: {
          type: "noul",
          instructions: "Is the underlying outcome, recommendation, or premise of the user's question affirmative or likely to happen?",
          criteria: {
            true: "The outcome leans affirmative, positive, or advisable.",
            false: "The outcome leans doubtful, negative, or unadvisable."
          }
        },
        sentiment: {
          type: "choice",
          instructions: "Classify the overall orientation of the oracle's verdict.",
          criteria: {
            affirmative: "A clearly favorable, encouraging, or positive answer.",
            neutral: "Uncertain, ambiguous, hazy, or premature to determine.",
            negative: "An unfavorable, contrary, or discouraging answer."
          }
        },
        aphorism: {
          type: "choice",
          instructions: "Select the most accurate Magic 8-Ball statement to deliver.",
          criteria: {
            certain: "It is certain or without a doubt.",
            yes_definitely: "Yes definitely or decidedly so.",
            signs_yes: "Signs point to yes or most likely.",
            reply_hazy: "Reply hazy, try again.",
            cannot_predict: "Cannot predict now or ask again later.",
            my_reply_no: "My reply is no or outlook not so good.",
            very_doubtful: "Very doubtful or don't count on it."
          }
        }
      }
    };

    const response = await fetch(JEV_DECISIONS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/oiupoyt/jev-8ball",
        "X-Title": "Jev 8-Ball Oracle (Cloudflare)"
      },
      body: JSON.stringify(payload)
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({
        error: "OpenRouter decision error",
        details: errText,
        fallback: fallbackDecision(cleanQuestion)
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const answers = data.answers || {};

    const favorableNoul = answers.favorable?.noul ?? 0.5;
    const sentimentChoice = answers.sentiment?.choice || (favorableNoul > 0.6 ? "affirmative" : favorableNoul < 0.4 ? "negative" : "neutral");
    const aphorismKey = answers.aphorism?.choice;

    let answerText = APHORISMS[aphorismKey]?.text;
    if (!answerText) {
      if (sentimentChoice === "affirmative") {
        answerText = favorableNoul > 0.8 ? "It is certain." : "Signs point to yes.";
      } else if (sentimentChoice === "negative") {
        answerText = favorableNoul < 0.2 ? "My reply is no." : "Outlook not so good.";
      } else {
        answerText = "Reply hazy, try again.";
      }
    }

    const result = {
      question: cleanQuestion,
      answer: answerText,
      sentiment: sentimentChoice,
      noul: favorableNoul,
      confidence: answers.sentiment?.confidence ?? answers.aphorism?.confidence ?? 0.85,
      probabilities: answers.sentiment?.probabilities || {},
      aphorismKey: aphorismKey || "signs_yes",
      latency,
      cost: data.usage?.cost ?? 0,
      usage: data.usage || {},
      model: data.model || MODEL,
      raw: data
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    const latency = Date.now() - startTime;
    return new Response(JSON.stringify({
      question: cleanQuestion,
      ...fallbackDecision(cleanQuestion),
      latency,
      offline: true
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function fallbackDecision(question) {
  let hash = 0;
  for (let i = 0; i < question.length; i++) {
    hash = (hash << 5) - hash + question.charCodeAt(i);
    hash |= 0;
  }
  const keys = Object.keys(APHORISMS);
  const selectedKey = keys[Math.abs(hash) % keys.length];
  const item = APHORISMS[selectedKey];
  return {
    answer: item.text,
    sentiment: item.sentiment,
    noul: item.sentiment === "affirmative" ? 0.78 : item.sentiment === "negative" ? 0.22 : 0.5,
    confidence: 0.8,
    probabilities: { [item.sentiment]: 0.8 },
    aphorismKey: selectedKey,
    model: "typesafe/jev-1.13 (offline-cache)"
  };
}
