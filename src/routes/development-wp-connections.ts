import { FastifyPluginAsync } from 'fastify';
import { wpConnectionUpsertSchema, WpConnectionUpsertBody } from '../schemas/wp-connections.js';
import { encryptText } from '../utils/wp-crypto.js';

const developmentWpConnectionsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // GET /projects/:id/development/wp-connections
  app.get<{ Params: { id: string } }>('/:id/development/wp-connections', auth, async (request, reply) => {
    const conns = await app.prisma.wpConnection.findMany({
      where: { projectId: request.params.id },
      orderBy: { env: 'asc' },
    });

    // Never return plaintext passwords
    return conns.map(c => ({
      env: c.env,
      siteUrl: c.siteUrl,
      wpUsername: c.wpUsername,
      status: c.status,
      notes: c.notes,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    }));
  });

  // PUT /projects/:id/development/wp-connections/:env
  app.put<{ Params: { id: string; env: string }; Body: WpConnectionUpsertBody }>(
    '/:id/development/wp-connections/:env',
    auth,
    async (request, reply) => {
      const body = wpConnectionUpsertSchema.parse(request.body);
      const env = request.params.env;

      const parsedEnv = (['DEV', 'STAGING', 'PRODUCTION'] as const).includes(env as any)
        ? (env as 'DEV' | 'STAGING' | 'PRODUCTION')
        : null;

      if (!parsedEnv) {
        return reply.code(400).send({ error: 'Invalid env. Use DEV | STAGING | PRODUCTION.' });
      }

      const existing = await app.prisma.wpConnection.findUnique({
        where: { projectId_env: { projectId: request.params.id, env: parsedEnv } },
      });

      const encrypted = body.wpAppPassword
        ? encryptText(body.wpAppPassword)
        : existing?.wpAppPasswordEnc;

      const updated = await app.prisma.wpConnection.upsert({
        where: { projectId_env: { projectId: request.params.id, env: parsedEnv } },
        update: {
          siteUrl: body.siteUrl,
          wpUsername: body.wpUsername,
          wpAppPasswordEnc: encrypted,
          status: body.status,
          notes: body.notes,
        },
        create: {
          projectId: request.params.id,
          env: parsedEnv,
          siteUrl: body.siteUrl,
          wpUsername: body.wpUsername,
          wpAuthType: 'APP_PASSWORD',
          wpAppPasswordEnc: encrypted,
          status: body.status ?? 'ACTIVE',
          notes: body.notes,
        },
      });

      // Never return plaintext password
      return {
        env: updated.env,
        siteUrl: updated.siteUrl,
        wpUsername: updated.wpUsername,
        status: updated.status,
        notes: updated.notes,
        updatedAt: updated.updatedAt,
        createdAt: updated.createdAt,
      };
    }
  );
};

export default developmentWpConnectionsRoutes;

