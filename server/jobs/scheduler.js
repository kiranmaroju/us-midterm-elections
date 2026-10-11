import { execute, query } from '../db/db.js';
import { fetchManifoldOdds } from '../fetchers/manifold_fetcher.js';
import { fetchLiveNews } from '../fetchers/news_fetcher.js';
import { fetchFecCandidates } from '../fetchers/fec_fetcher.js';
import { fetchCongressLegislators } from '../fetchers/congress_fetcher.js';
import { fetchWikipediaDetails } from '../fetchers/wikipedia_fetcher.js';

let intervalTimer = null;
const runningJobs = new Set();

/**
 * Registry of executable job functions
 */
const jobHandlers = {
  sync_odds: async () => {
    return await fetchManifoldOdds();
  },
  sync_news: async () => {
    return await fetchLiveNews();
  },
  sync_fec_candidates: async () => {
    return await fetchFecCandidates();
  },
  sync_legislators_deep: async () => {
    const legRes = await fetchCongressLegislators();
    const wikiRes = await fetchWikipediaDetails();
    return {
      success: legRes.success && wikiRes.success,
      recordsAdded: (legRes.recordsAdded || 0) + (wikiRes.recordsAdded || 0),
      recordsUpdated: (legRes.recordsUpdated || 0) + (wikiRes.recordsUpdated || 0),
      logs: `${legRes.logs}\n${wikiRes.logs}`
    };
  }
};

/**
 * Execute a specific job and log audit trail
 */
export async function runJob(jobId) {
  if (runningJobs.has(jobId)) {
    console.log(`[Job Scheduler] Job "${jobId}" is already running. Skipping.`);
    return { status: 'ALREADY_RUNNING' };
  }

  const handler = jobHandlers[jobId];
  if (!handler) {
    throw new Error(`Unknown job handler "${jobId}"`);
  }

  runningJobs.add(jobId);
  const startTime = new Date();

  // Mark job as RUNNING
  await execute(`
    UPDATE jobs 
    SET status = 'RUNNING' 
    WHERE id = ?;
  `, [jobId]);

  console.log(`[Job Scheduler] Executing job: ${jobId} at ${startTime.toISOString()}`);

  let result = null;
  let status = 'SUCCESS';
  let errorMsg = null;

  try {
    result = await handler();
    if (!result?.success) {
      status = 'FAILED';
      errorMsg = result?.error || 'Job returned failure status';
    }
  } catch (err) {
    status = 'FAILED';
    errorMsg = err.message;
    result = { logs: `Fatal Exception: ${err.stack}`, recordsAdded: 0, recordsUpdated: 0 };
  }

  const finishTime = new Date();
  const durationMs = finishTime.getTime() - startTime.getTime();
  const recordsAdded = result?.recordsAdded || 0;
  const recordsUpdated = result?.recordsUpdated || 0;
  const logOutput = result?.logs || errorMsg || 'Job completed.';

  // Fetch job interval to compute next_run_at
  const [jobRecord] = await query(`SELECT schedule_interval_mins FROM jobs WHERE id = ?;`, [jobId]);
  const intervalMins = jobRecord?.schedule_interval_mins || 15;
  const nextRunTime = new Date(finishTime.getTime() + intervalMins * 60 * 1000);

  // Update job record
  await execute(`
    UPDATE jobs 
    SET status = ?,
        last_run_at = ?,
        next_run_at = ?,
        last_duration_ms = ?,
        last_status_message = ?
    WHERE id = ?;
  `, [
    status,
    finishTime.toISOString().slice(0, 19).replace('T', ' '),
    nextRunTime.toISOString().slice(0, 19).replace('T', ' '),
    durationMs,
    status === 'SUCCESS' ? `Success (${recordsAdded + recordsUpdated} records affected)` : `Error: ${errorMsg}`,
    jobId
  ]);

  // Record audit log
  await execute(`
    INSERT INTO job_audit_logs (job_id, started_at, finished_at, duration_ms, status, records_added, records_updated, log_output)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    jobId,
    startTime.toISOString().slice(0, 19).replace('T', ' '),
    finishTime.toISOString().slice(0, 19).replace('T', ' '),
    durationMs,
    status,
    recordsAdded,
    recordsUpdated,
    logOutput
  ]);

  runningJobs.delete(jobId);
  console.log(`[Job Scheduler] Finished ${jobId} in ${durationMs}ms with status ${status}`);

  return {
    jobId,
    status,
    durationMs,
    recordsAdded,
    recordsUpdated,
    nextRunTime
  };
}

/**
 * Continuous scheduler loop checking due jobs
 */
export function startScheduler() {
  console.log('[Job Scheduler] Starting background worker loop (checks every 60 seconds)...');
  
  // Run loop every 60 seconds
  intervalTimer = setInterval(async () => {
    try {
      const now = new Date();
      const dueJobs = await query(`
        SELECT id, schedule_interval_mins, last_run_at, next_run_at 
        FROM jobs 
        WHERE is_enabled = TRUE AND status != 'RUNNING';
      `);

      for (const j of dueJobs) {
        let isDue = false;
        if (!j.last_run_at || !j.next_run_at) {
          isDue = true;
        } else {
          const nextRun = new Date(j.next_run_at);
          if (now >= nextRun) {
            isDue = true;
          }
        }

        if (isDue) {
          // Launch in background
          runJob(j.id).catch(e => console.error(`[Job Auto-Run Error] ${j.id}:`, e));
        }
      }
    } catch (schedErr) {
      console.error('[Job Scheduler Loop Error]', schedErr.message);
    }
  }, 60 * 1000);
}

export function stopScheduler() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
