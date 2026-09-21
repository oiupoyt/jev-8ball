/**
 * Regression tests for the Cloudflare Worker entrypoint.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.mjs';

const realFetch = globalThis.fetch;

function ask(body) {
  return new Request('https://oracle.test/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function status() {
  return new Request('https://oracle.test/api/status');
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('status reports where the key came from', async () => {
  globalThis.fetch = () => {
    throw new Error('status must not call upstream');
  };
  const viaRepo = await (await worker.fetch(status(), {}, {})).json();
  assert.equal(viaRepo.hasKey, true);
  assert.equal(viaRepo.keySource, 'repo');

  const viaEnv = await (
    await worker.fetch(status(), { OPENROUTER_API_KEY: 'test-key' }, {})
  ).json();
  assert.equal(viaEnv.hasKey, true);
  assert.equal(viaEnv.keySource, 'env');
});

test('a configured key always wins over the in-repo one', async () => {
  let authorization = null;
  globalThis.fetch = async (url, init) => {
    authorization = init.headers.Authorization;
    return new Response(JSON.stringify({ answers: {} }), { status: 200 });
  };
  await worker.fetch(ask({ question: 'Will it deploy?' }), { OPENROUTER_API_KEY: 'env-key' }, {});
  assert.equal(authorization, 'Bearer env-key');
});

test('invalid input is rejected before any upstream call', async () => {
  const env = { OPENROUTER_API_KEY: 'test-key' };
  globalThis.fetch = () => {
    throw new Error('upstream must not be called');
  };
  assert.equal((await worker.fetch(ask('{ not json'), env, {})).status, 400);
  assert.equal((await worker.fetch(ask({ question: '   ' }), env, {})).status, 400);
  assert.equal((await worker.fetch(ask({}), env, {})).status, 400);
  // Oversized questions are trimmed rather than rejected.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ answers: {}, model: 'typesafe/jev-1.13' }), { status: 200 });
  const long = await (
    await worker.fetch(ask({ question: 'x'.repeat(900) }), env, {})
  ).json();
  assert.equal(long.question.length, 300);
});

test('a decisive verdict replaces a hazy aphorism', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        answers: {
          favorable: { noul: 0.9 },
          sentiment: { choice: 'neutral', confidence: 0.93, probabilities: { affirmative: 0.9 } },
          aphorism: { choice: 'reply_hazy' }
        },
        usage: { cost: 0.000001 },
        model: 'typesafe/jev-1.13'
      }),
      { status: 200 }
    );

  const response = await worker.fetch(
    ask({ question: 'Will it deploy?' }),
    { OPENROUTER_API_KEY: 'test-key' },
    {}
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  const payload = await response.json();
  assert.equal(payload.aphorismKey, 'certain');
  assert.equal(payload.answer, 'It is certain.');
  assert.equal(payload.sentiment, 'affirmative');
  assert.equal(payload.noul, 0.9);
  assert.equal(payload.offline, undefined);
});

test('an upstream failure keeps its status and still ships a usable fallback', async () => {
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  const response = await worker.fetch(
    ask({ question: 'Any luck?' }),
    { OPENROUTER_API_KEY: 'test-key' },
    {}
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  const payload = await response.json();
  assert.equal(payload.error, 'OpenRouter decision error');
  assert.ok(payload.fallback.answer);
});

test('a thrown upstream error becomes a deterministic offline fallback', async () => {
  const env = { OPENROUTER_API_KEY: 'test-key' };
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const realError = console.error;
  console.error = () => {};
  try {
    const first = await (await worker.fetch(ask({ question: 'Any luck?' }), env, {})).json();
    const second = await (await worker.fetch(ask({ question: 'Any luck?' }), env, {})).json();
    assert.equal(first.offline, true);
    assert.ok(first.answer);
    assert.equal(first.answer, second.answer);
  } finally {
    console.error = realError;
  }
});
