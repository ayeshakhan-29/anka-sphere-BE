import { FastifyPluginAsync } from 'fastify';
import { decryptText } from '../utils/wp-crypto.js';
import { wpPluginSchema, wpThemeSchema, WpPluginBody, WpThemeBody } from '../schemas/wp-deployment.js';

function stripHtml(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/<[^>]*>/g, '').trim() || undefined;
}

function textFromWp(value: unknown): string | undefined {
  if (typeof value === 'string') return stripHtml(value) ?? value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return textFromWp(obj.raw) ?? textFromWp(obj.rendered);
  }
  return undefined;
}

async function wpGet(siteUrl: string, username: string, appPassword: string, endpoint: string) {
  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/${endpoint}`;
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message: unknown }).message)
      : `WP API error: ${res.status}`;
    throw new Error(message);
  }
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

async function getDevConnection(app: any, projectId: string) {
  return app.prisma.wpConnection.findUnique({
    where: { projectId_env: { projectId, env: 'DEV' } },
  });
}

const wpPluginsThemesRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Params: { id: string } }>(
    '/:id/development/wp-plugins',
    auth,
    async (request, reply) => {
      const projectId = request.params.id;
      const connection = await getDevConnection(app, projectId);

      if (connection?.wpAppPasswordEnc) {
        try {
          const appPassword = decryptText(connection.wpAppPasswordEnc);
          const plugins = await wpGet(connection.siteUrl, connection.wpUsername, appPassword, 'plugins?context=edit&per_page=100');
          await app.prisma.$transaction(
            plugins.map((plugin) => {
              const slug = String(plugin.plugin ?? plugin.slug ?? plugin.textdomain ?? plugin.name ?? '').trim();
              if (!slug) return null;
              const name = textFromWp(plugin.name) ?? slug;
              return app.prisma.wPPlugin.upsert({
                where: { projectId_slug: { projectId, slug } },
                update: {
                  name,
                  version: plugin.version ? String(plugin.version) : undefined,
                  status: plugin.status === 'active' ? 'ACTIVE' : 'INACTIVE',
                  description: textFromWp(plugin.description),
                  lastUpdatedAt: new Date(),
                },
                create: {
                  projectId,
                  slug,
                  name,
                  version: plugin.version ? String(plugin.version) : undefined,
                  status: plugin.status === 'active' ? 'ACTIVE' : 'INACTIVE',
                  description: textFromWp(plugin.description),
                  lastUpdatedAt: new Date(),
                },
              });
            }).filter((op): op is NonNullable<typeof op> => !!op),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sync WordPress plugins';
          return reply.code(502).send({ error: `Failed to sync WordPress plugins: ${message}` });
        }
      }

      return app.prisma.wPPlugin.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
      });
    },
  );

  app.put<{ Params: { id: string; slug: string }; Body: WpPluginBody }>(
    '/:id/development/wp-plugins/:slug',
    auth,
    async (request) => {
      const body = wpPluginSchema.parse(request.body);
      return app.prisma.wPPlugin.upsert({
        where: { projectId_slug: { projectId: request.params.id, slug: request.params.slug } },
        update: {
          name: body.name,
          version: body.version,
          status: body.status,
          description: body.description,
          lastUpdatedAt: new Date(),
        },
        create: {
          projectId: request.params.id,
          slug: request.params.slug,
          name: body.name,
          version: body.version,
          status: body.status,
          description: body.description,
          lastUpdatedAt: new Date(),
        },
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id/development/wp-themes',
    auth,
    async (request, reply) => {
      const projectId = request.params.id;
      const connection = await getDevConnection(app, projectId);

      if (connection?.wpAppPasswordEnc) {
        try {
          const appPassword = decryptText(connection.wpAppPasswordEnc);
          const themes = await wpGet(connection.siteUrl, connection.wpUsername, appPassword, 'themes?context=edit&per_page=100');
          await app.prisma.$transaction(
            themes.map((theme) => {
              const slug = String(theme.stylesheet ?? theme.template ?? theme.slug ?? theme.name ?? '').trim();
              if (!slug) return null;
              const name = textFromWp(theme.name) ?? slug;
              return app.prisma.wPTheme.upsert({
                where: { projectId_slug: { projectId, slug } },
                update: {
                  name,
                  version: theme.version ? String(theme.version) : undefined,
                  status: theme.status === 'active' ? 'ACTIVE' : 'INACTIVE',
                  description: textFromWp(theme.description),
                  lastUpdatedAt: new Date(),
                },
                create: {
                  projectId,
                  slug,
                  name,
                  version: theme.version ? String(theme.version) : undefined,
                  status: theme.status === 'active' ? 'ACTIVE' : 'INACTIVE',
                  description: textFromWp(theme.description),
                  lastUpdatedAt: new Date(),
                },
              });
            }).filter((op): op is NonNullable<typeof op> => !!op),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sync WordPress themes';
          return reply.code(502).send({ error: `Failed to sync WordPress themes: ${message}` });
        }
      }

      return app.prisma.wPTheme.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
      });
    },
  );

  app.put<{ Params: { id: string; slug: string }; Body: WpThemeBody }>(
    '/:id/development/wp-themes/:slug',
    auth,
    async (request) => {
      const body = wpThemeSchema.parse(request.body);
      return app.prisma.wPTheme.upsert({
        where: { projectId_slug: { projectId: request.params.id, slug: request.params.slug } },
        update: {
          name: body.name,
          version: body.version,
          status: body.status,
          description: body.description,
          lastUpdatedAt: new Date(),
        },
        create: {
          projectId: request.params.id,
          slug: request.params.slug,
          name: body.name,
          version: body.version,
          status: body.status,
          description: body.description,
          lastUpdatedAt: new Date(),
        },
      });
    },
  );
};

export default wpPluginsThemesRoutes;

