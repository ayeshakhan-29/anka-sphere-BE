import { FastifyPluginAsync } from 'fastify';
import { wpPluginSchema, wpThemeSchema, WpPluginBody, WpThemeBody } from '../schemas/wp-deployment.js';

const wpPluginsThemesRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── WP Plugins ────────────────────────────────────────────────────────────────

  // GET /projects/:id/development/wp-plugins
  app.get<{ Params: { id: string } }>(
    '/:id/development/wp-plugins',
    auth,
    async (request) => {
      return app.prisma.wPPlugin.findMany({
        where: { projectId: request.params.id },
        orderBy: { name: 'asc' },
      });
    },
  );

  // PUT /projects/:id/development/wp-plugins/:slug
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

  // ── WP Themes ────────────────────────────────────────────────────────────────

  // GET /projects/:id/development/wp-themes
  app.get<{ Params: { id: string } }>(
    '/:id/development/wp-themes',
    auth,
    async (request) => {
      return app.prisma.wPTheme.findMany({
        where: { projectId: request.params.id },
        orderBy: { name: 'asc' },
      });
    },
  );

  // PUT /projects/:id/development/wp-themes/:slug
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
