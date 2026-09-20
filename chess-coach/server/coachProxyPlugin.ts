import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Small dev-server-only proxy for the Anthropic API.
 *
 * This is the ONLY place the Anthropic API key is read. It runs inside
 * Vite's Node process (never bundled for the browser), so `src/` code can
 * only ever reach Claude through a `fetch('/api/coach', ...)` call — the
 * key itself never ships to the client.
 *
 * Registered via `configureServer`, which is dev-server-only: this proxy
 * exists for `npm run dev` (the app's only supported way to run, per
 * CLAUDE.md's local-first/single-user scope), not for `vite preview` or a
 * static production build.
 */

interface CoachRequestBody {
  model?: 'haiku' | 'sonnet';
  system?: string;
  prompt?: string;
  maxTokens?: number;
}

const MODEL_IDS: Record<NonNullable<CoachRequestBody['model']>, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5',
};

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

async function handleCoachRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendError(
      res,
      500,
      'ANTHROPIC_API_KEY is not set. Add it to chess-coach/.env (see .env.example) and restart the dev server.',
    );
    return;
  }

  let body: CoachRequestBody;
  try {
    body = JSON.parse(await readRequestBody(req));
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  const modelId = body.model ? MODEL_IDS[body.model] : undefined;
  if (!modelId || !body.system || !body.prompt) {
    sendError(res, 400, 'Request must include model ("haiku" | "sonnet"), system, and prompt');
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  // Headers aren't actually flushed until the first write/end, so as long as
  // nothing has streamed yet a failure (bad key, rate limit, etc.) can still
  // report a real error status the client's `!response.ok` check catches.
  // Only once text has started do we fall back to an inline marker, since a
  // status can no longer be set at that point.
  let wroteAny = false;
  const client = new Anthropic({ apiKey });
  try {
    const stream = client.messages.stream({
      model: modelId,
      max_tokens: body.maxTokens ?? 400,
      system: body.system,
      messages: [{ role: 'user', content: body.prompt }],
    });
    stream.on('text', (delta) => {
      wroteAny = true;
      res.write(delta);
    });
    await stream.finalMessage();
    res.end();
  } catch (error) {
    const message = error instanceof Anthropic.APIError ? error.message : 'Coaching request failed';
    if (wroteAny) {
      res.end(`\n[coach error] ${message}`);
    } else {
      sendError(res, 502, message);
    }
  }
}

export function coachProxyPlugin(): Plugin {
  return {
    name: 'chess-coach-anthropic-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/coach', (req, res) => {
        void handleCoachRequest(req, res);
      });
    },
  };
}
