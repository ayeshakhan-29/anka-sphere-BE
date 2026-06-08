import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { loginSchema, registerSchema, LoginBody, RegisterBody } from '../schemas/auth.js';

const authRoutes: FastifyPluginAsync = async (app) => {

  // POST /auth/register
  app.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const existing = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await app.prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        name: body.name,
        role: body.role ?? 'CONTENT_WRITER',
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return reply.code(201).send({ token, user });
  });

  // POST /auth/login
  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  // GET /auth/me  (protected)
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: { id: true, email: true, name: true, role: true, avatarUrl: true, createdAt: true },
    });
    return user;
  });
};

export default authRoutes;
