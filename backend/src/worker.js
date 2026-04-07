/**
 * Standalone BullMQ worker process.
 * Runs all background job workers without starting the Express server.
 * In production, PM2 runs this as a separate process from the API.
 */
require('dotenv').config();

const redis = require('./config/redis');
const { schedulePenaltyJob, createPenaltyWorker } = require('./jobs/penaltyJob');
const { scheduleReminderJobs, createReminderWorker } = require('./jobs/reminderJob');

const workers = [];

async function start() {
  console.log('[Worker] Starting BullMQ worker process...');
  console.log(`[Worker] Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
  console.log(`[Worker] PID: ${process.pid}, ENV: ${process.env.NODE_ENV || 'development'}`);

  // Create worker instances
  workers.push(createPenaltyWorker());
  workers.push(createReminderWorker());

  // Schedule repeatable jobs (idempotent — removes old schedules first)
  await schedulePenaltyJob();
  await scheduleReminderJobs();

  console.log(`[Worker] ${workers.length} workers active, waiting for jobs...`);
}

async function shutdown(signal) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  await Promise.all(
    workers.map((w) =>
      w.close().catch((err) => console.error(`[Worker] Error closing: ${err.message}`))
    )
  );

  try {
    await redis.quit();
  } catch {
    // ignore
  }

  console.log('[Worker] All workers stopped.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection:', reason);
  process.exit(1);
});

start().catch((err) => {
  console.error('[Worker] Failed to start:', err);
  process.exit(1);
});
