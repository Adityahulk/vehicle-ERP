const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const { processOverduePenalties, sendPenaltyWhatsApp } = require('../services/penaltyService');

const QUEUE_NAME = 'penalty-processing';

const penaltyQueue = new Queue(QUEUE_NAME, { connection: redis });

async function schedulePenaltyJob() {
  const existing = await penaltyQueue.getRepeatableJobs();
  for (const job of existing) {
    await penaltyQueue.removeRepeatableByKey(job.key);
  }

  await penaltyQueue.add(
    'daily-penalty-check',
    {},
    {
      repeat: { pattern: '0 30 2 * * *' }, // 2:30 AM UTC = 8:00 AM IST
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 50 },
    },
  );

  console.log('[PenaltyJob] Daily penalty check scheduled at 8:00 AM IST');
}

function createPenaltyWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log('[PenaltyJob] Running daily penalty check...');
      const updatedLoans = await processOverduePenalties();
      console.log(`[PenaltyJob] Updated ${updatedLoans.length} overdue loans`);

      for (const loan of updatedLoans) {
        await sendPenaltyWhatsApp(loan);
      }

      return { processed: updatedLoans.length };
    },
    { connection: redis },
  );

  worker.on('completed', (job, result) => {
    console.log(`[PenaltyJob] Completed: ${result.processed} loans processed`);
  });

  worker.on('failed', (job, err) => {
    console.error('[PenaltyJob] Failed:', err.message);
  });

  return worker;
}

// Auto-start worker when not in production (dev mode — API process handles it)
// In production, worker.js imports createPenaltyWorker() explicitly
const penaltyWorker = process.env.NODE_ENV !== 'production' ? createPenaltyWorker() : null;

module.exports = { penaltyQueue, penaltyWorker, schedulePenaltyJob, createPenaltyWorker };
