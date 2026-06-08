import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: 'Validation error',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if ('code' in error && error.code === 'P2025') {
    return reply.code(404).send({ error: 'Record not found' });
  }

  if ('code' in error && error.code === 'P2002') {
    return reply.code(409).send({ error: 'Duplicate entry' });
  }

  const statusCode = error.statusCode ?? 500;
  reply.code(statusCode).send({ error: error.message ?? 'Internal server error' });
}
