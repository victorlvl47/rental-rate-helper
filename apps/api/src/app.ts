import cors from '@fastify/cors';
import Fastify from 'fastify';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: 'http://localhost:3000',
});

app.get('/health', async () => ({
  status: 'ok',
  service: 'rental-rate-helper-api',
}));

export default app;
