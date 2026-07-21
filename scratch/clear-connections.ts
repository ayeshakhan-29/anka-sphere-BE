import 'dotenv/config';
import { buildApp } from '../src/app.js';

async function main() {
  const app = await buildApp({ logger: false });
  await app.ready();
  await app.prisma.integrationConnection.deleteMany();
  console.log('Successfully cleared all mock integration connections from database!');
  await app.close();
  process.exit(0);
}

main();
