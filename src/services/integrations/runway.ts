import { FastifyInstance } from 'fastify';
import { IntegrationUnavailableError, IntegrationRequestError } from './errors.js';

const API_BASE = 'https://api.dev.runwayml.com/v1';
// Every Runway API call must pin a version date via the X-Runway-Version header
const API_VERSION = '2024-11-06';

/** gen4_turbo = 5 credits/second at $0.01/credit ≈ $0.05 per second of video. */
export const RUNWAY_COST_PER_SECOND = 0.05;

export function isRunwayConfigured(): boolean {
  return Boolean(process.env.RUNWAY_API_KEY);
}

function requireKey(): string {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    throw new IntegrationUnavailableError('AI video generation is not configured (missing RUNWAY_API_KEY).');
  }
  return apiKey;
}

function apiHeaders(apiKey: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Runway-Version': API_VERSION,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export interface RunwayVideoOptions {
  prompt: string;
  duration: 5 | 10;
  ratio: string;   // e.g. '1280:720'
  image?: string;  // data URI or https URL — switches text→video to image→video
  projectId?: string;
  userName?: string;
}

interface MockTask {
  status: RunwayTaskState;
  progress: number;
  videoUrl: string | null;
  createdAt: number;
}

const mockTasks = new Map<string, MockTask>();

function startMockTaskSimulation(taskId: string) {
  let progress = 0;
  const interval = setInterval(() => {
    const task = mockTasks.get(taskId);
    if (!task) {
      clearInterval(interval);
      return;
    }
    progress += 0.2;
    if (progress >= 1.0) {
      progress = 1.0;
      task.status = 'SUCCEEDED';
      task.progress = 1.0;
      task.videoUrl = 'https://www.w3schools.com/html/movie.mp4';
      clearInterval(interval);
    } else {
      task.status = 'RUNNING';
      task.progress = progress;
    }
  }, 1500);
}

/**
 * Kick off an async video generation task and return its id.
 * Cost is committed once Runway accepts the task, so usage is logged here;
 * the task id is embedded in the usage event's operation so the poll route
 * can recover the original prompt when saving the finished asset.
 * Throws IntegrationUnavailableError when no key is configured,
 * IntegrationRequestError on upstream failures.
 */
export async function createRunwayVideoTask(
  app: FastifyInstance,
  opts: RunwayVideoOptions,
): Promise<{ taskId: string; costUsd: number }> {
  const apiKey = requireKey();
  const costUsd = opts.duration * RUNWAY_COST_PER_SECOND;

  const logUsage = (success: boolean, taskId?: string) =>
    app.prisma.apiUsageEvent.create({
      data: {
        provider: 'RUNWAY_GEN4_TURBO',
        operation: taskId ? `video.generate:${taskId}` : 'video.generate',
        projectId: opts.projectId,
        userName: opts.userName,
        prompt: opts.prompt.slice(0, 500),
        costUsd: success ? costUsd : 0,
        success,
      },
    }).catch((err: unknown) => app.log.error({ err }, 'Failed to log Runway usage'));

  const isMock = apiKey.startsWith('mock') || apiKey.startsWith('dummy');

  if (isMock) {
    const taskId = `mock-${Math.random().toString(36).substring(2, 15)}`;
    mockTasks.set(taskId, {
      status: 'PENDING',
      progress: 0,
      videoUrl: null,
      createdAt: Date.now(),
    });
    startMockTaskSimulation(taskId);
    await logUsage(true, taskId);
    return { taskId, costUsd };
  }

  const endpoint = opts.image ? 'image_to_video' : 'text_to_video';
  const payload = {
    model: 'gen4.5',
    promptText: opts.prompt,
    ratio: opts.ratio,
    duration: opts.duration,
    ...(opts.image ? { promptImage: opts.image } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: apiHeaders(apiKey, true),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    await logUsage(false);
    app.log.error({ err }, 'Runway video request failed');
    throw new IntegrationRequestError('Could not reach the Runway video service.');
  }

  if (!res.ok) {
    await logUsage(false);
    const detail = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    app.log.error({ status: res.status, detail }, 'Runway API returned an error');
    throw new IntegrationRequestError(
      detail?.error ?? detail?.message ?? 'Runway video generation failed to start.',
      res.status === 401 ? 503 : 422,
    );
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    await logUsage(false);
    throw new IntegrationRequestError('Runway returned no task id.');
  }

  await logUsage(true, json.id);
  return { taskId: json.id, costUsd };
}

export type RunwayTaskState = 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface RunwayTaskStatus {
  status: RunwayTaskState;
  progress: number;        // 0–1
  videoUrl: string | null; // ephemeral (~24 h) — download promptly
  failure: string | null;
}

/** Poll a Runway task. Throws IntegrationRequestError on upstream failures. */
export async function getRunwayVideoTask(app: FastifyInstance, taskId: string): Promise<RunwayTaskStatus> {
  if (taskId.startsWith('mock-')) {
    const task = mockTasks.get(taskId);
    if (!task) throw new IntegrationRequestError('Runway video task not found.', 404);
    return {
      status: task.status,
      progress: task.progress,
      videoUrl: task.videoUrl,
      failure: null,
    };
  }

  const apiKey = requireKey();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`, { headers: apiHeaders(apiKey) });
  } catch (err) {
    app.log.error({ err, taskId }, 'Runway task poll failed');
    throw new IntegrationRequestError('Could not reach the Runway video service.');
  }

  if (res.status === 404) throw new IntegrationRequestError('Runway video task not found.', 404);
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    app.log.error({ status: res.status, detail, taskId }, 'Runway task poll returned an error');
    throw new IntegrationRequestError(
      detail?.error ?? detail?.message ?? 'Could not check the video generation status.',
      res.status === 401 ? 503 : 502,
    );
  }

  const json = (await res.json()) as {
    status?: string;
    progress?: number;
    output?: string[];
    failure?: string;
    failureCode?: string;
  };

  return {
    status: (json.status as RunwayTaskState) ?? 'PENDING',
    progress: typeof json.progress === 'number' ? json.progress : 0,
    videoUrl: json.output?.[0] ?? null,
    failure: json.failure ?? json.failureCode ?? null,
  };
}

/** Runway output URLs expire within ~24 h — inline the bytes as base64 so the asset never dies. */
export async function downloadRunwayVideo(url: string): Promise<string> {
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    return parts[1] || parts[0];
  }

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new IntegrationRequestError('Could not download the generated video.');
  }
  if (!res.ok) throw new IntegrationRequestError('Could not download the generated video.');
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}
