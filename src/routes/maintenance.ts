import { FastifyPluginAsync } from 'fastify';
import {
  backupSchema,
  perfNoteSchema,
  updateUptimeSchema,
  BackupBody,
  PerfNoteBody,
  UpdateUptimeBody,
} from '../schemas/maintenance.js';

const maintenanceRoutes: FastifyPluginAsync = async (app) => {

  // All routes require authentication
  app.addHook('preHandler', app.authenticate);

  // GET /maintenance — fetch current maintenance record
  app.get('/', async () => {
    const record = await app.prisma.maintenance.findFirst({ orderBy: { updatedAt: 'desc' } });
    return record ?? { uptimeStatus: 'OPERATIONAL', backupLog: '', performanceNotes: '' };
  });

  // PATCH /maintenance/uptime — update uptime status
  app.patch<{ Body: UpdateUptimeBody }>('/uptime', async (request, reply) => {
    const body = updateUptimeSchema.parse(request.body);
    const record = await upsertMaintenance(app);
    const updated = await app.prisma.maintenance.update({
      where: { id: record.id },
      data: { uptimeStatus: body.uptimeStatus },
    });
    return updated;
  });

  // POST /maintenance/backup — trigger a backup and log it
  app.post<{ Body: BackupBody }>('/backup', async (request, reply) => {
    const body = backupSchema.parse(request.body);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] Backup triggered${body.note ? ` — ${body.note}` : ''}`;

    const record = await upsertMaintenance(app);
    const updated = await app.prisma.maintenance.update({
      where: { id: record.id },
      data: {
        backupLog: record.backupLog
          ? `${record.backupLog}\n${entry}`
          : entry,
      },
    });
    return { message: 'Backup completed', backupLog: updated.backupLog };
  });

  // POST /maintenance/perf-note — record a performance note
  app.post<{ Body: PerfNoteBody }>('/perf-note', async (request, reply) => {
    const body = perfNoteSchema.parse(request.body);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${body.message}`;

    const record = await upsertMaintenance(app);
    const updated = await app.prisma.maintenance.update({
      where: { id: record.id },
      data: {
        performanceNotes: record.performanceNotes
          ? `${record.performanceNotes}\n${entry}`
          : entry,
      },
    });
    return { message: 'Performance note recorded', performanceNotes: updated.performanceNotes };
  });
};

async function upsertMaintenance(app: any) {
  let record = await app.prisma.maintenance.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!record) {
    record = await app.prisma.maintenance.create({
      data: { uptimeStatus: 'OPERATIONAL', backupLog: '', performanceNotes: '' },
    });
  }
  return record;
}

export default maintenanceRoutes;
