import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const generateImageSchema = z.object({
  prompt: z.string().min(3).max(4000),
  size: z.enum(['1024x1024', '1792x1024', '1024x1792']).default('1024x1024'),
  saveToAssets: z.boolean().default(false),
  assetName: z.string().optional(),
});

// DALL-E 3 standard-quality pricing (USD per image)
const DALLE3_COST: Record<string, number> = {
  '1024x1024': 0.04,
  '1792x1024': 0.08,
  '1024x1792': 0.08,
};

const aiRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // POST /projects/:id/design/ai-images  — generate an image with DALL-E 3
  app.post<{ Params: { id: string } }>('/:id/design/ai-images', auth, async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({ error: 'AI image generation is not configured (missing OPENAI_API_KEY).' });
    }
    const body = generateImageSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { name: true },
    });

    const logUsage = (success: boolean) =>
      app.prisma.apiUsageEvent.create({
        data: {
          provider: 'OPENAI_DALLE3',
          operation: 'image.generate',
          projectId: request.params.id,
          userName: user?.name,
          prompt: body.prompt.slice(0, 500),
          costUsd: success ? DALLE3_COST[body.size] : 0,
          success,
        },
      });

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: body.prompt,
          n: 1,
          size: body.size,
          quality: 'standard',
          response_format: 'b64_json',
        }),
      });
    } catch (err) {
      await logUsage(false);
      app.log.error({ err }, 'DALL-E request failed');
      return reply.code(502).send({ error: 'Could not reach the image generation service.' });
    }

    if (!res.ok) {
      await logUsage(false);
      const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      app.log.error({ status: res.status, detail }, 'DALL-E returned an error');
      return reply
        .code(res.status === 401 ? 503 : 422)
        .send({ error: detail?.error?.message ?? 'Image generation failed.' });
    }

    const json = (await res.json()) as { data: { b64_json: string; revised_prompt?: string }[] };
    const b64 = json.data[0]?.b64_json;
    if (!b64) {
      await logUsage(false);
      return reply.code(502).send({ error: 'Image generation returned no image.' });
    }
    await logUsage(true);

    const dataUri = `data:image/png;base64,${b64}`;

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
          url: dataUri,
          notes: `AI-generated (DALL-E 3). Prompt: ${body.prompt.slice(0, 300)}`,
        },
      });
    }

    return {
      image: dataUri,
      revisedPrompt: json.data[0]?.revised_prompt ?? null,
      costUsd: DALLE3_COST[body.size],
      asset,
    };
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
