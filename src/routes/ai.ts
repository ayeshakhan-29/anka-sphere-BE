import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { chatJSON, AiUnavailableError, AiRequestError } from '../services/openai.js';
import {
  generateStabilityImage,
  STABILITY_IMAGE_COST,
} from '../services/integrations/stability.js';
import { uploadToS3 } from '../services/s3.js';
import {
  createRunwayVideoTask,
  getRunwayVideoTask,
  downloadRunwayVideo,
} from '../services/integrations/runway.js';

const generateImageSchema = z.object({
  prompt: z.string().min(3).max(4000),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
  model: z.enum(['openai', 'stability']).default('openai'),
  saveToAssets: z.boolean().default(false),
  assetName: z.string().optional(),
});

// gpt-image-1 medium-quality pricing (USD per image)
const IMAGE_COST: Record<string, number> = {
  '1024x1024': 0.04,
  '1536x1024': 0.06,
  '1024x1536': 0.06,
};

const aiRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // POST /projects/:id/design/ai-images  — generate an image (OpenAI gpt-image-1 or Stability Core)
  app.post<{ Params: { id: string } }>('/:id/design/ai-images', auth, async (request, reply) => {
    const body = generateImageSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { name: true },
    });

    let dataUri: string;
    let revisedPrompt: string | null = null;
    let costUsd: number;

    if (body.model === 'stability') {
      // Errors carry a statusCode and are translated by the global error handler
      const b64 = await generateStabilityImage(app, {
        prompt: body.prompt,
        size: body.size,
        operation: 'image.generate',
        projectId: request.params.id,
        userName: user?.name,
      });
      dataUri = `data:image/png;base64,${b64}`;
      costUsd = STABILITY_IMAGE_COST;
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return reply.code(503).send({ error: 'AI image generation is not configured (missing OPENAI_API_KEY).' });
      }

      const logUsage = (success: boolean) =>
        app.prisma.apiUsageEvent.create({
          data: {
            provider: 'OPENAI_GPT_IMAGE_1',
            operation: 'image.generate',
            projectId: request.params.id,
            userName: user?.name,
            prompt: body.prompt.slice(0, 500),
            costUsd: success ? IMAGE_COST[body.size] : 0,
            success,
          },
        });

      let res: Response;
      try {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: body.prompt,
            n: 1,
            size: body.size,
            quality: 'medium',
          }),
        });
      } catch (err) {
        await logUsage(false);
        app.log.error({ err }, 'Image generation request failed');
        return reply.code(502).send({ error: 'Could not reach the image generation service.' });
      }

      if (!res.ok) {
        await logUsage(false);
        const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        app.log.error({ status: res.status, detail }, 'Image API returned an error');
        return reply
          .code(res.status === 401 ? 503 : 422)
          .send({ error: detail?.error?.message ?? 'Image generation failed.' });
      }

      const json = (await res.json()) as { data: { b64_json?: string; url?: string; revised_prompt?: string }[] };
      let b64 = json.data[0]?.b64_json;
      if (!b64 && json.data[0]?.url) {
        // API returned a short-lived URL — download and inline it so the asset never expires
        const imgRes = await fetch(json.data[0].url);
        if (imgRes.ok) b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
      }
      if (!b64) {
        await logUsage(false);
        return reply.code(502).send({ error: 'Image generation returned no image.' });
      }
      await logUsage(true);

      dataUri = `data:image/png;base64,${b64}`;
      revisedPrompt = json.data[0]?.revised_prompt ?? null;
      costUsd = IMAGE_COST[body.size];
    }

    const modelLabel = body.model === 'stability' ? 'Stable Image Core' : 'gpt-image-1';

    const finalImageUrl = await uploadToS3(dataUri, 'ai-image');

    let asset = null;
    if (body.saveToAssets) {
      const design = await app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      asset = await app.prisma.designAsset.create({
        data: {
          designId: design.id,
          name: body.assetName ?? `AI · ${body.prompt.slice(0, 60)}`,
          type: 'IMAGE',
          url: finalImageUrl,
          notes: `AI-generated (${modelLabel}). Prompt: ${body.prompt.slice(0, 300)}`,
        },
      });
    }

    return {
      image: finalImageUrl,
      revisedPrompt,
      costUsd,
      asset,
    };
  });

  // POST /projects/:id/design/ai-images/edit — refine an existing image with an instruction
  const editImageSchema = z.object({
    image: z.string().startsWith('data:image/'),
    instruction: z.string().min(3).max(4000),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
  });

  app.post<{ Params: { id: string } }>(
    '/:id/design/ai-images/edit',
    { preHandler: [app.authenticate], bodyLimit: 25 * 1024 * 1024 },
    async (request, reply) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return reply.code(503).send({ error: 'AI image generation is not configured (missing OPENAI_API_KEY).' });
      }
      const body = editImageSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { name: true },
      });

      const logUsage = (success: boolean) =>
        app.prisma.apiUsageEvent.create({
          data: {
            provider: 'OPENAI_GPT_IMAGE_1',
            operation: 'image.edit',
            projectId: request.params.id,
            userName: user?.name,
            prompt: body.instruction.slice(0, 500),
            costUsd: success ? IMAGE_COST[body.size] : 0,
            success,
          },
        });

      const srcBytes = Buffer.from(body.image.split(',')[1] ?? '', 'base64');
      if (srcBytes.length === 0) {
        return reply.code(422).send({ error: 'Invalid source image.' });
      }

      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', body.instruction);
      form.append('size', body.size);
      form.append('quality', 'medium');
      form.append('image', new Blob([new Uint8Array(srcBytes)], { type: 'image/png' }), 'image.png');

      let res: Response;
      try {
        res = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch (err) {
        await logUsage(false);
        app.log.error({ err }, 'Image edit request failed');
        return reply.code(502).send({ error: 'Could not reach the image generation service.' });
      }

      if (!res.ok) {
        await logUsage(false);
        const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        app.log.error({ status: res.status, detail }, 'Image edit API returned an error');
        return reply
          .code(res.status === 401 ? 503 : 422)
          .send({ error: detail?.error?.message ?? 'Image edit failed.' });
      }

      const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
      let b64 = json.data[0]?.b64_json;
      if (!b64 && json.data[0]?.url) {
        const imgRes = await fetch(json.data[0].url);
        if (imgRes.ok) b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
      }
      if (!b64) {
        await logUsage(false);
        return reply.code(502).send({ error: 'Image edit returned no image.' });
      }
      await logUsage(true);

      const finalImageUrl = await uploadToS3(`data:image/png;base64,${b64}`, 'ai-image-edit');

      return {
        image: finalImageUrl,
        revisedPrompt: null,
        costUsd: IMAGE_COST[body.size],
        asset: null,
      };
    },
  );

  // ── AI video generation (Runway gen4_turbo — async task API) ───────────────

  const generateVideoSchema = z.object({
    prompt: z.string().min(3).max(1000),
    duration: z.union([z.literal(5), z.literal(10)]).default(5),
    ratio: z.enum(['1280:720', '720:1280', '960:960']).default('1280:720'),
    // Optional source image (data URI) switches text→video to image→video
    image: z.string().startsWith('data:image/').optional(),
  });

  // POST /projects/:id/design/ai-videos — start an async generation task
  app.post<{ Params: { id: string } }>(
    '/:id/design/ai-videos',
    { preHandler: [app.authenticate], bodyLimit: 25 * 1024 * 1024 },
    async (request) => {
      const body = generateVideoSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { name: true },
      });

      // Errors carry a statusCode and are translated by the global error handler
      const { taskId, costUsd } = await createRunwayVideoTask(app, {
        prompt: body.prompt,
        duration: body.duration,
        ratio: body.ratio,
        image: body.image,
        projectId: request.params.id,
        userName: user?.name,
      });

      return { taskId, costUsd };
    },
  );

  // GET /projects/:id/design/ai-videos/:taskId — poll task progress
  app.get<{ Params: { id: string; taskId: string } }>(
    '/:id/design/ai-videos/:taskId',
    auth,
    async (request) => getRunwayVideoTask(app, request.params.taskId),
  );

  // POST /projects/:id/design/ai-videos/:taskId/save — persist the finished video
  // as a DesignAsset. The server re-checks the task and downloads the output
  // itself (Runway URLs expire in ~24 h and clients must not supply arbitrary
  // URLs to inline).
  const saveVideoSchema = z.object({ assetName: z.string().max(200).optional() });

  app.post<{ Params: { id: string; taskId: string } }>(
    '/:id/design/ai-videos/:taskId/save',
    auth,
    async (request, reply) => {
      const body = saveVideoSchema.parse(request.body ?? {});

      const task = await getRunwayVideoTask(app, request.params.taskId);
      if (task.status !== 'SUCCEEDED' || !task.videoUrl) {
        return reply.code(409).send({ error: 'The video is not ready yet.' });
      }

      const b64 = await downloadRunwayVideo(task.videoUrl);
      const dataUri = `data:video/mp4;base64,${b64}`;

      const finalVideoUrl = await uploadToS3(dataUri, 'ai-video');

      // The create call logged the prompt with the task id — recover it for the notes
      const usage = await app.prisma.apiUsageEvent.findFirst({
        where: { operation: `video.generate:${request.params.taskId}` },
        select: { prompt: true },
      });
      const prompt = usage?.prompt ?? '';

      const design = await app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const asset = await app.prisma.designAsset.create({
        data: {
          designId: design.id,
          name: body.assetName ?? `AI Video · ${prompt.slice(0, 60) || request.params.taskId}`,
          type: 'VIDEO',
          url: finalVideoUrl,
          notes: prompt ? `AI-generated (Runway gen4_turbo). Prompt: ${prompt.slice(0, 300)}` : 'AI-generated (Runway gen4_turbo).',
        },
      });

      return { asset };
    },
  );

  // POST /projects/:id/social/ai-captions — write A/B caption variants in the client's brand voice
  const captionSchema = z.object({
    platform: z.enum(['Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'X']),
    topic: z.string().min(3).max(1000),
  });
  const PLATFORM_LIMIT: Record<string, number> = {
    Instagram: 2200, TikTok: 2200, Facebook: 63206, LinkedIn: 3000, X: 280,
  };

  app.post<{ Params: { id: string } }>('/:id/social/ai-captions', auth, async (request, reply) => {
    const body = captionSchema.parse(request.body);

    const [project, user] = await Promise.all([
      app.prisma.project.findUnique({
        where: { id: request.params.id },
        include: { profiling: true, marketing: true },
      }),
      app.prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } }),
    ]);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const p = project.profiling;
    const brandContext = [
      `Client: ${p?.companyName ?? project.clientName}`,
      p?.industry && `Industry: ${p.industry}`,
      p?.about && `About: ${p.about}`,
      p?.brandVoice && `Brand voice: ${p.brandVoice}`,
      p?.tagline && `Tagline: ${p.tagline}`,
      p?.brandDislikes && `Never do: ${p.brandDislikes}`,
      project.marketing?.targetAudience && `Target audience: ${project.marketing.targetAudience}`,
    ].filter(Boolean).join('\n');

    const limit = PLATFORM_LIMIT[body.platform];
    try {
      const result = await chatJSON<{ variantA: string; variantB: string; hashtags: string[] }>(app, {
        operation: 'caption.generate',
        projectId: request.params.id,
        userName: user?.name,
        system:
          `You are a senior social media copywriter at a digital agency. Write platform-native captions ` +
          `that sound like the client's brand, never generic marketing filler. Respond with a single JSON object: ` +
          `{"variantA": string, "variantB": string, "hashtags": string[]}. ` +
          `variantA is short and punchy; variantB is longer, storytelling style. ` +
          `Both must fit within ${limit} characters for ${body.platform} (including spacing and emoji, excluding hashtags). ` +
          `hashtags: 8-12 relevant hashtags, each starting with #. Do not put hashtags inside the variants.`,
        user: `Brand context:\n${brandContext}\n\nPost topic / instructions:\n${body.topic}`,
      });
      return {
        variantA: String(result.variantA ?? ''),
        variantB: String(result.variantB ?? ''),
        hashtags: Array.isArray(result.hashtags) ? result.hashtags.map(String) : [],
      };
    } catch (err) {
      if (err instanceof AiUnavailableError) return reply.code(503).send({ error: 'AI caption writing is not configured (missing OPENAI_API_KEY).' });
      if (err instanceof AiRequestError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /projects/:id/reports/ai-draft — write a report narrative from live project data
  const reportDraftSchema = z.object({ type: z.enum(['WEEKLY', 'MONTHLY']) });

  app.post<{ Params: { id: string } }>('/:id/reports/ai-draft', auth, async (request, reply) => {
    const body = reportDraftSchema.parse(request.body);

    const [project, user] = await Promise.all([
      app.prisma.project.findUnique({
        where: { id: request.params.id },
        include: {
          pipeline: true,
          milestones: true,
          design: { include: { tasks: true } },
          development: { include: { tasks: true } },
          marketing: { include: { tasks: true } },
        },
      }),
      app.prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } }),
    ]);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const tasks = [
      ...(project.design?.tasks ?? []).map(t => ({ dept: 'Design', title: t.title, status: String(t.status) })),
      ...(project.development?.tasks ?? []).map(t => ({ dept: 'Development', title: t.title, status: String(t.status) })),
      ...(project.marketing?.tasks ?? []).map(t => ({ dept: 'Marketing', title: t.title, status: String(t.status) })),
    ];
    const facts = [
      `Project: ${project.name} for ${project.clientName}`,
      `Current stage: ${project.currentStage} (stages approved: ${project.pipeline.filter(s => s.status === 'APPROVED').length}/5)`,
      `Milestones done: ${project.milestones.filter(m => m.status === 'DONE').length}/${project.milestones.length}`,
      `Tasks (${tasks.length}):`,
      ...tasks.slice(0, 40).map(t => `- [${t.dept}] ${t.title} — ${t.status}`),
    ].join('\n');

    try {
      const result = await chatJSON<{ summary: string; highlights: string; blockers: string; nextSteps: string }>(app, {
        operation: 'report.draft',
        projectId: request.params.id,
        userName: user?.name,
        system:
          `You write concise client-facing agency status reports. Base every claim strictly on the facts given — ` +
          `never invent metrics, dates, or events. Plain professional English, no buzzwords. ` +
          `Respond with a single JSON object: {"summary": string, "highlights": string, "blockers": string, "nextSteps": string}. ` +
          `summary: 3-5 sentences on overall ${body.type === 'WEEKLY' ? 'weekly' : 'monthly'} progress. ` +
          `highlights: 2-4 bullet lines (plain text, one per line, no markdown). ` +
          `blockers: risks or open items inferred from incomplete tasks, or "No blockers at this time." ` +
          `nextSteps: 2-4 bullet lines of what the team tackles next, inferred from TODO/IN_PROGRESS tasks.`,
        user: facts,
      });
      return {
        summary: String(result.summary ?? ''),
        highlights: String(result.highlights ?? ''),
        blockers: String(result.blockers ?? ''),
        nextSteps: String(result.nextSteps ?? ''),
      };
    } catch (err) {
      if (err instanceof AiUnavailableError) return reply.code(503).send({ error: 'AI report drafting is not configured (missing OPENAI_API_KEY).' });
      if (err instanceof AiRequestError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /projects/:id/content/ai-page-draft — first-draft page copy + SEO meta
  const pageDraftSchema = z.object({
    title: z.string().min(2).max(200),
    notes: z.string().max(1000).optional(),
  });

  app.post<{ Params: { id: string } }>('/:id/content/ai-page-draft', auth, async (request, reply) => {
    const body = pageDraftSchema.parse(request.body);

    const [project, user] = await Promise.all([
      app.prisma.project.findUnique({
        where: { id: request.params.id },
        include: { profiling: true, content: true },
      }),
      app.prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } }),
    ]);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const p = project.profiling;
    const c = project.content;
    const context = [
      `Client: ${p?.companyName ?? project.clientName}`,
      p?.industry && `Industry: ${p.industry}`,
      p?.about && `About: ${p.about}`,
      p?.brandVoice && `Brand voice: ${p.brandVoice}`,
      p?.tagline && `Tagline: ${p.tagline}`,
      p?.primaryKeywords && `Primary keywords: ${p.primaryKeywords}`,
      c?.contentBrief && `Content brief: ${c.contentBrief}`,
      c?.toneOfVoice && `Tone of voice: ${c.toneOfVoice}`,
      c?.seoGuidelines && `SEO guidelines: ${c.seoGuidelines}`,
    ].filter(Boolean).join('\n');

    try {
      const result = await chatJSON<{ body: string; seoTitle: string; seoDescription: string }>(app, {
        operation: 'page.draft',
        projectId: request.params.id,
        userName: user?.name,
        system:
          `You are a senior website copywriter at a digital agency. Write a first draft the client's content team ` +
          `will refine — clear structure, on-brand, no lorem ipsum, no invented facts (leave [PLACEHOLDER] markers ` +
          `for specifics you cannot know like prices or dates). Respond with a single JSON object: ` +
          `{"body": string, "seoTitle": string, "seoDescription": string}. ` +
          `body: 300-500 words of page copy in plain text with section headings on their own lines. ` +
          `seoTitle: max 60 characters including the brand name. seoDescription: 120-155 characters.`,
        user: `Brand & content context:\n${context}\n\nPage to write: "${body.title}"${body.notes ? `\nExtra notes: ${body.notes}` : ''}`,
      });
      return {
        body: String(result.body ?? ''),
        seoTitle: String(result.seoTitle ?? ''),
        seoDescription: String(result.seoDescription ?? ''),
      };
    } catch (err) {
      if (err instanceof AiUnavailableError) return reply.code(503).send({ error: 'AI drafting is not configured (missing OPENAI_API_KEY).' });
      if (err instanceof AiRequestError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /projects/:id/paid/ai-ad-copy — ad copy variants for Google / Meta
  const adCopySchema = z.object({
    network: z.enum(['GOOGLE', 'META']),
    goal: z.string().min(3).max(1000),
  });

  app.post<{ Params: { id: string } }>('/:id/paid/ai-ad-copy', auth, async (request, reply) => {
    const body = adCopySchema.parse(request.body);

    const [project, user] = await Promise.all([
      app.prisma.project.findUnique({
        where: { id: request.params.id },
        include: { profiling: true, marketing: true },
      }),
      app.prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } }),
    ]);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const p = project.profiling;
    const context = [
      `Client: ${p?.companyName ?? project.clientName}`,
      p?.industry && `Industry: ${p.industry}`,
      p?.about && `About: ${p.about}`,
      p?.brandVoice && `Brand voice: ${p.brandVoice}`,
      p?.tagline && `Tagline: ${p.tagline}`,
      p?.brandDislikes && `Never do: ${p.brandDislikes}`,
      project.marketing?.targetAudience && `Target audience: ${project.marketing.targetAudience}`,
    ].filter(Boolean).join('\n');

    const spec = body.network === 'GOOGLE'
      ? `Google Ads responsive search ad. "headlines": exactly 6 strings, each max 30 characters. ` +
        `"descriptions": exactly 4 strings, each max 90 characters.`
      : `Meta (Facebook/Instagram) ad. "headlines": exactly 4 strings, each max 40 characters. ` +
        `"descriptions": exactly 3 primary-text strings, each 80-125 characters, hook first.`;

    try {
      const result = await chatJSON<{ headlines: string[]; descriptions: string[] }>(app, {
        operation: 'adcopy.generate',
        projectId: request.params.id,
        userName: user?.name,
        system:
          `You are a senior performance marketing copywriter. Write scroll-stopping, on-brand ad copy — ` +
          `specific benefits over vague claims, no clickbait, no ALL CAPS. Respond with a single JSON object: ` +
          `{"headlines": string[], "descriptions": string[]}. ${spec}`,
        user: `Brand context:\n${context}\n\nCampaign goal:\n${body.goal}`,
      });
      return {
        headlines: Array.isArray(result.headlines) ? result.headlines.map(String) : [],
        descriptions: Array.isArray(result.descriptions) ? result.descriptions.map(String) : [],
      };
    } catch (err) {
      if (err instanceof AiUnavailableError) return reply.code(503).send({ error: 'AI ad copy is not configured (missing OPENAI_API_KEY).' });
      if (err instanceof AiRequestError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // GET /projects/:id/design/ai-usage — usage tracker (project + workspace totals)
  app.get<{ Params: { id: string } }>('/:id/design/ai-usage', auth, async (request) => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [projectEvents, monthAgg, totalAgg] = await Promise.all([
      app.prisma.apiUsageEvent.findMany({
        where: { projectId: request.params.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      app.prisma.apiUsageEvent.aggregate({
        where: { createdAt: { gte: monthStart }, success: true },
        _count: true,
        _sum: { costUsd: true },
      }),
      app.prisma.apiUsageEvent.aggregate({
        where: { success: true },
        _count: true,
        _sum: { costUsd: true },
      }),
    ]);

    return {
      recent: projectEvents,
      month: { count: monthAgg._count, costUsd: monthAgg._sum.costUsd ?? 0 },
      total: { count: totalAgg._count, costUsd: totalAgg._sum.costUsd ?? 0 },
    };
  });
};

export default aiRoutes;
