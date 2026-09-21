import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// The repo intentionally carries a key so a fresh clone (or deploy) works with no
// secret configured. Delete this constant and set OPENROUTER_API_KEY to require one.
const REPO_API_KEY = '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';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || REPO_API_KEY;
const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = 'typesafe/jev-1.13';
const LAYA_API_URL = process.env.LAYA_API_URL || 'http://192.168.0.103:8888';

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('[jev-8ball] OPENROUTER_API_KEY is not set — using the in-repo key.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Classic Magic 8-Ball aphorisms dictionary
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

// GET /api/status
app.get('/api/status', async (req, res) => {
  let layaOnline = false;
  let layaData = null;

  try {
    const layaRes = await fetch(`${LAYA_API_URL}/api/status`, {
      signal: AbortSignal.timeout(1200)
    });
    if (layaRes.ok) {
      layaData = await layaRes.json();
      layaOnline = Boolean(layaData.status === 'online' || layaData.ready);
    }
  } catch (err) {
    layaOnline = false;
  }

  res.json({
    status: 'online',
    model: layaOnline ? (layaData?.model || 'convaiinnovations/laya-typed-decisions') : MODEL,
    engine: layaOnline ? 'Laya System 1 Decision Model (Android Tablet)' : 'TypeSafe Jev (Cloud Decision Engine)',
    tablet: layaOnline,
    layaUrl: LAYA_API_URL,
    layaInfo: layaData,
    hasKey: Boolean(OPENROUTER_API_KEY),
    keySource: process.env.OPENROUTER_API_KEY ? 'env' : 'repo'
  });
});

// POST /api/ask
app.post('/api/ask', async (req, res) => {
  if (!OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'Oracle is not configured. Set OPENROUTER_API_KEY.' });
  }

  const { question } = req.body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  const cleanQuestion = question.trim().slice(0, 300);
  const startTime = performance.now();

  // 1. Attempt inference on Android Tablet running Laya System 1
  try {
    const layaRes = await fetch(`${LAYA_API_URL}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: cleanQuestion }),
      signal: AbortSignal.timeout(6500)
    });

    if (layaRes.ok) {
      const data = await layaRes.json();
      const latency = Math.round(performance.now() - startTime);
      return res.json({
        question: cleanQuestion,
        answer: data.answer,
        sentiment: data.sentiment,
        noul: data.noul,
        confidence: data.confidence,
        probabilities: data.probabilities || {},
        aphorismKey: data.aphorismKey || 'signs_yes',
        latency,
        cost: 0,
        usage: { prompt_tokens: data.raw?.usage?.input_tokens ?? 38, completion_tokens: 0 },
        model: data.model || 'convaiinnovations/laya-typed-decisions',
        engine: 'Laya System 1 (Android Tablet ARM64)',
        tablet: true,
        raw: data
      });
    }
  } catch (layaErr) {
    // Graceful fallback to OpenRouter Jev cloud API
    console.warn(`[jev-8ball] Tablet Laya not reachable (${layaErr.message}), falling back to OpenRouter Jev`);
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'Oracle is not configured. Set OPENROUTER_API_KEY.' });
  }

  try {
    const payload = {
      model: MODEL,
      state: {
        question: cleanQuestion,
        directive: "You are the definitive Magic 8-Ball oracle. Every query demands a bold, prophetic, decisive verdict (affirmative or negative). You must actively choose a clear side. Do NOT default to hazy, ambiguous, or neutral answers unless the user's question is completely incomprehensible gibberish or an impossible paradox."
      },
      questions: {
        favorable: {
          type: "noul",
          instructions: "Determine whether the fortune leans affirmative/favorable (1.0) or negative/adverse (0.0). Make a firm choice and avoid sitting in the ambiguous 0.45 - 0.55 zone.",
          criteria: {
            true: "The fortune favors yes, affirmative, or an auspicious outcome.",
            false: "The fortune favors no, negative, or an inauspicious outcome."
          }
        },
        sentiment: {
          type: "choice",
          instructions: "Declare the oracle's verdict as either affirmative or negative. Reserve neutral strictly for non-questions or unparseable gibberish.",
          criteria: {
            affirmative: "Auspicious, affirmative, or confirming prophecy.",
            negative: "Inauspicious, negative, or adverse prophecy.",
            neutral: "Strictly unparseable gibberish or logical paradox."
          }
        },
        aphorism: {
          type: "choice",
          instructions: "Select the authentic Magic 8-Ball prophecy that best fits the question.",
          criteria: {
            certain: "It is certain.",
            yes_definitely: "Yes definitely.",
            signs_yes: "Signs point to yes.",
            outlook_good: "Outlook good.",
            most_likely: "Most likely.",
            my_reply_no: "My reply is no.",
            very_doubtful: "Very doubtful.",
            outlook_bad: "Outlook not so good.",
            dont_count: "Don't count on it.",
            reply_hazy: "Reply hazy, try again (strictly reserved for total gibberish)."
          }
        }
      }
    };

    const response = await fetch(JEV_DECISIONS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/oiupoyt/jev-8ball',
        'X-Title': 'Jev 8-Ball Oracle (Dev)'
      },
      body: JSON.stringify(payload)
    });

    const latency = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenRouter Decision Error:', response.status, errText);
      return res.status(response.status).json({
        error: 'OpenRouter decision error',
        details: errText,
        fallback: fallbackDecision(cleanQuestion)
      });
    }

    const data = await response.json();
    const answers = data.answers || {};

    const favorableNoul = answers.favorable?.noul ?? 0.5;
    let sentimentChoice = answers.sentiment?.choice;
    if (!sentimentChoice || sentimentChoice === "neutral") {
      sentimentChoice = favorableNoul >= 0.5 ? "affirmative" : "negative";
    }
    let aphorismKey = answers.aphorism?.choice;

    // Prevent unwanted hazy response if noul shows conviction
    if (aphorismKey === "reply_hazy" || aphorismKey === "cannot_predict") {
      if (favorableNoul >= 0.5) {
        aphorismKey = favorableNoul > 0.75 ? "certain" : "signs_yes";
      } else {
        aphorismKey = favorableNoul < 0.3 ? "my_reply_no" : "outlook_bad";
      }
    }

    let answerText = APHORISMS[aphorismKey]?.text;
    if (!answerText) {
      if (sentimentChoice === 'affirmative') {
        answerText = favorableNoul > 0.75 ? "It is certain." : "Signs point to yes.";
      } else if (sentimentChoice === 'negative') {
        answerText = favorableNoul < 0.25 ? "My reply is no." : "Outlook not so good.";
      } else {
        answerText = favorableNoul >= 0.5 ? "Signs point to yes." : "Outlook not so good.";
      }
    }

    return res.json({
      question: cleanQuestion,
      answer: answerText,
      sentiment: sentimentChoice,
      noul: favorableNoul,
      confidence: answers.sentiment?.confidence ?? answers.aphorism?.confidence ?? 0.85,
      probabilities: answers.sentiment?.probabilities || {},
      aphorismKey: aphorismKey || 'signs_yes',
      latency,
      cost: data.usage?.cost ?? 0,
      usage: data.usage || {},
      model: data.model || MODEL,
      raw: data
    });

  } catch (err) {
    console.error('Server exception during Jev request:', err);
    const latency = Math.round(performance.now() - startTime);
    return res.json({
      question: cleanQuestion,
      ...fallbackDecision(cleanQuestion),
      latency,
      offline: true
    });
  }
});

// Calibrated fallback in case of offline/network interruption
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
    noul: item.sentiment === 'affirmative' ? 0.78 : item.sentiment === 'negative' ? 0.22 : 0.5,
    confidence: 0.8,
    probabilities: { [item.sentiment]: 0.8 },
    aphorismKey: selectedKey,
    model: 'typesafe/jev-1.13 (offline-cache)'
  };
}

// SPA fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[jev-8ball] Server running at http://localhost:${PORT}`);
  console.log(`[jev-8ball] Primary Engine: Laya on Android Tablet (${LAYA_API_URL})`);
  console.log(`[jev-8ball] Fallback Engine: ${MODEL} via OpenRouter Decisions API`);
});
