import { devTaskSchema } from './dist/schemas/development.js';

const payload = {
  title: 'New Task',
  status: 'SETUP',
  priority: 'MEDIUM',
  sortOrder: 1
};

try {
  const result = devTaskSchema.parse(payload);
  console.log('SUCCESS:', result);
} catch (e) {
  console.error('FAIL:', e.errors || e);
}
