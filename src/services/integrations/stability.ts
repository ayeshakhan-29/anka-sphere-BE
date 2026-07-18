import { FastifyInstance } from 'fastify';
import { IntegrationUnavailableError, IntegrationRequestError } from './errors.js';

const GENERATE_URL = 'https://api.stability.ai/v2beta/stable-image/generate/core';

/** Stable Image Core = 3 credits ≈ $0.03 per image, any aspect ratio. */
export const STABILITY_IMAGE_COST = 0.03;

/** The design tab's size picker maps onto Stability aspect ratios (~1.5 MP output). */
const ASPECT_RATIOS: Record<string, string> = {
  '1024x1024': '1:1',
  '1536x1024': '3:2',
  '1024x1536': '2:3',
};

export function isStabilityConfigured(): boolean {
  return Boolean(process.env.STABILITY_API_KEY);
}

interface StabilityImageOptions {
  prompt: string;
  size: string;
  operation: string;   // logged to the API usage tracker, e.g. "image.generate"
  projectId?: string;
  userName?: string;
}

/**
 * Generate an image with Stable Image Core and return it as base64 PNG.
 * Logs cost + outcome to the ApiUsageEvent tracker. Throws
 * IntegrationUnavailableError when no key is configured,
 * IntegrationRequestError on upstream failures.
 */
export async function generateStabilityImage(app: FastifyInstance, opts: StabilityImageOptions): Promise<string> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) {
    throw new IntegrationUnavailableError('Stability image generation is not configured (missing STABILITY_API_KEY).');
  }

  const logUsage = (success: boolean) =>
    app.prisma.apiUsageEvent.create({
      data: {
        provider: 'STABILITY_CORE',
        operation: opts.operation,
        projectId: opts.projectId,
        userName: opts.userName,
        prompt: opts.prompt.slice(0, 500),
        costUsd: success ? STABILITY_IMAGE_COST : 0,
        success,
      },
    }).catch((err: unknown) => app.log.error({ err }, 'Failed to log Stability usage'));

  const form = new FormData();
  form.append('prompt', opts.prompt);
  form.append('aspect_ratio', ASPECT_RATIOS[opts.size] ?? '1:1');
  form.append('output_format', 'png');

  let res: Response;
  try {
    res = await fetch(GENERATE_URL, {
      method: 'POST',
      // Accept: application/json → base64 payload instead of raw bytes
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    await logUsage(false);
    app.log.error({ err }, 'Stability image request failed');
    throw new IntegrationRequestError('Could not reach the Stability image service.');
  }

  if (!res.ok) {
    await logUsage(false);
    const detail = (await res.json().catch(() => null)) as { errors?: string[]; message?: string } | null;
    app.log.error({ status: res.status, detail }, 'Stability API returned an error');
    throw new IntegrationRequestError(
      detail?.errors?.join(' ') ?? detail?.message ?? 'Stability image generation failed.',
      res.status === 401 ? 503 : 422,
    );
  }

  const json = (await res.json()) as { image?: string; finish_reason?: string };
  if (json.finish_reason === 'CONTENT_FILTERED') {
    await logUsage(false);
    throw new IntegrationRequestError("The prompt was blocked by Stability's content filter.", 422);
  }
  if (!json.image) {
    await logUsage(false);
    throw new IntegrationRequestError('Stability returned no image.');
  }

  await logUsage(true);
  return json.image;
}
