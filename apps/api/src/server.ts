import app from './app.js';

const DEFAULT_PORT = 8080;

function getPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid API_PORT \"${value}\". Expected an integer from 1 to 65535.`);
  }

  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT \"${value}\". Expected an integer from 1 to 65535.`);
  }

  return port;
}

async function start(): Promise<void> {
  try {
    const port = getPort(process.env.API_PORT);
    const address = await app.listen({ host: '0.0.0.0', port });
    app.log.info(`API listening at ${address}`);
  } catch (error) {
    app.log.error(error, 'Failed to start API server');
    process.exit(1);
  }
}

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  app.log.info(`Received ${signal}; shutting down API server`);

  try {
    await app.close();
    app.log.info('API server closed');
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'Failed to shut down API server cleanly');
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void start();
