import { runJob } from './scheduler.js';

async function main() {
  console.log('[Runner] Starting comprehensive initial sync...');
  
  console.log('[Runner] 1/4: Ingesting Congress legislators and Wikimedia portraits...');
  await runJob('sync_legislators_deep');

  console.log('[Runner] 2/4: Ingesting Manifold prediction market odds...');
  await runJob('sync_odds');

  console.log('[Runner] 3/4: Ingesting Politico, NPR, and The Hill live news...');
  await runJob('sync_news');

  console.log('[Runner] 4/4: Ingesting Federal Election Commission candidate filings...');
  await runJob('sync_fec_candidates');

  console.log('[Runner] Complete! All tables populated with authentic data.');
  process.exit(0);
}

main().catch(err => {
  console.error('[Runner Fatal]', err);
  process.exit(1);
});
