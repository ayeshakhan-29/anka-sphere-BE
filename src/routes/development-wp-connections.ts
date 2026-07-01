import { FastifyPluginAsync } from 'fastify';
import { wpConnectionUpsertSchema, WpConnectionUpsertBody } from '../schemas/wp-connections.js';
import { encryptText, decryptText } from '../utils/wp-crypto.js';

type WpConnectionHealth = {
  connectionOk: boolean;
  connectionMessage: string;
};

function connectionResponse(c: {
  env: string;
  siteUrl: string;
  wpUsername: string;
  status: string;
  notes: string | null;
  updatedAt: Date;
  createdAt: Date;
}, health?: WpConnectionHealth) {
  return {
    env: c.env,
    siteUrl: c.siteUrl,
    wpUsername: c.wpUsername,
    status: c.status,
    notes: c.notes,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
    connectionOk: health?.connectionOk ?? c.status === 'ACTIVE',
    connectionMessage: health?.connectionMessage ?? (c.status === 'ACTIVE' ? 'Connected' : 'Connection inactive'),
  };
}

async function checkWpConnection(c: { siteUrl: string; wpUsername: string; wpAppPasswordEnc: string | null; status: string }): Promise<WpConnectionHealth> {
  if (c.status !== 'ACTIVE') {
    return { connectionOk: false, connectionMessage: 'Connection inactive' };
  }

  if (!c.wpAppPasswordEnc) {
    return { connectionOk: false, connectionMessage: 'Connection lost: app password missing' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const appPassword = decryptText(c.wpAppPasswordEnc);
    const auth = Buffer.from(`${c.wpUsername}:${appPassword}`).toString('base64');
    const res = await fetch(`${c.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });

    if (res.ok) return { connectionOk: true, connectionMessage: 'Connected' };
    if (res.status === 401 || res.status === 403) {
      return { connectionOk: false, connectionMessage: 'Connection lost: check WP username or app password' };
    }
    return { connectionOk: false, connectionMessage: `Connection lost: WordPress returned ${res.status}` };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Connection lost: request timed out'
      : 'Connection lost: site unreachable';
    return { connectionOk: false, connectionMessage: message };
  } finally {
    clearTimeout(timeout);
  }
}
const developmentWpConnectionsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // GET /projects/:id/development/wp-connections
  app.get<{ Params: { id: string } }>('/:id/development/wp-connections', auth, async (request, reply) => {
    const conns = await app.prisma.wpConnection.findMany({
      where: { projectId: request.params.id },
      orderBy: { env: 'asc' },
    });

    // Never return plaintext passwords
    return Promise.all(conns.map(async c => connectionResponse(c, await checkWpConnection(c))));
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
      return connectionResponse(updated, await checkWpConnection(updated));
    }
  );
};

export default developmentWpConnectionsRoutes;
