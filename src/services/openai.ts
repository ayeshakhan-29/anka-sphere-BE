import { FastifyInstance } from 'fastify';

const CHAT_MODEL = 'gpt-5-mini';
// gpt-5-mini pricing (USD per token)
const INPUT_COST = 0.25 / 1_000_000;
const OUTPUT_COST = 2 / 1_000_000;

export class AiUnavailableError extends Error {}
export class AiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface ChatJsonOptions {
  system: string;
  user: string;
  operation: string;   // logged to the API usage tracker, e.g. "caption.generate"
  projectId?: string;
  userName?: string;
}

/**
 * Run a chat completion that must answer with a single JSON object.
 * Logs cost + outcome to the ApiUsageEvent tracker. Throws AiUnavailableError
 * when no key is configured, AiRequestError on upstream failures.
 */
export async function chatJSON<T>(app: FastifyInstance, opts: ChatJsonOptions): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiUnavailableError('OPENAI_API_KEY is not configured');

  const logUsage = (success: boolean, costUsd: number) =>
    app.prisma.apiUsageEvent.create({
      data: {
        provider: 'OPENAI_GPT5_MINI',
        operation: opts.operation,
        projectId: opts.projectId,
        userName: opts.userName,
        prompt: opts.user.slice(0, 500),
        costUsd,
        success,
      },
    }).catch((err: unknown) => app.log.error({ err }, 'Failed to log AI usage'));

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    await logUsage(false, 0);
    app.log.error({ err, operation: opts.operation }, 'AI chat request failed');
    throw new AiRequestError('Could not reach the AI service.', 502);
  }

  if (!res.ok) {
    await logUsage(false, 0);
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    app.log.error({ status: res.status, detail, operation: opts.operation }, 'AI chat returned an error');
    throw new AiRequestError(detail?.error?.message ?? 'AI request failed.', res.status === 401 ? 503 : 422);
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const costUsd =
    (json.usage?.prompt_tokens ?? 0) * INPUT_COST +
    (json.usage?.completion_tokens ?? 0) * OUTPUT_COST;

  const raw = json.choices[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) as T;
    await logUsage(true, Math.round(costUsd * 10000) / 10000);
    return parsed;
  } catch {
    await logUsage(false, Math.round(costUsd * 10000) / 10000);
    app.log.error({ raw: raw.slice(0, 300), operation: opts.operation }, 'AI returned unparseable JSON');
    throw new AiRequestError('The AI returned an unexpected format. Please try again.', 502);
  }
}
