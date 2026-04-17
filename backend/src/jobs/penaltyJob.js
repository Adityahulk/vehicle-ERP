const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const { query } = require('../config/db');
const { updateLoanPenalties } = require('../services/penaltyService');
const { insertPenaltyMilestoneTasks } = require('../services/whatsappPendingTasksService');

const QUEUE_NAME = 'penalty-processing';

const penaltyQueue = new Queue(QUEUE_NAME, { connection: redis });

async function schedulePenaltyJob() {
  const existing = await penaltyQueue.getRepeatableJobs();
  for (const job of existing) {
    await penaltyQueue.removeRepeatableByKey(job.key);
  }

  await penaltyQueue.add(
    'daily-penalty-update',
    {},
    {
      repeat: { pattern: '35 18 * * *' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 50 },
    },
  );

  console.log('[PenaltyJob] Scheduled dailyPenaltyUpdate at 00:05 AM IST (18:35 UTC)');
}

function createPenaltyWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log('[PenaltyJob] Running daily penalty update...');
      const result = await updateLoanPenalties(null);
      console.log('[PenaltyJob] Done:', {
        updated: result.updated,
        unchanged: result.unchanged,
        milestones: result.milestones?.length || 0,
        errors: result.errors?.length || 0,
      });

      try {
        await query(
          `INSERT INTO job_logs (job_name, result) VALUES ($1, $2::jsonb)`,
          ['dailyPenaltyUpdate', JSON.stringify(result)],
        );
      } catch (e) {
        console.error('[PenaltyJob] job_logs insert failed:', e.message);
      }

      await insertPenaltyMilestoneTasks(result.milestones || []).catch((e) =>
        console.error('[PenaltyJob] insertPenaltyMilestoneTasks:', e.message),
      );

      return result;
    },
    { connection: redis },
  );

  worker.on('completed', (job, res) => {
    console.log(`[PenaltyJob] ${job.name} completed: updated=${res?.updated}, unchanged=${res?.unchanged}`);
  });

  worker.on('failed', (job, err) => {
    console.error('[PenaltyJob] Failed:', err.message);
  });

  return worker;
}

const penaltyWorker = process.env.NODE_ENV !== 'production' ? createPenaltyWorker() : null;

module.exports = { penaltyQueue, penaltyWorker, schedulePenaltyJob, createPenaltyWorker };
