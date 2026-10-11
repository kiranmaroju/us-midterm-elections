import { execute, query } from '../db/db.js';

/**
 * Manifold Markets Real-Time Win Probabilities Fetcher
 * Authentic, free, zero authentication prediction market API
 */
export async function fetchManifoldOdds() {
  const logEntries = [];
  let recordsUpdated = 0;

  try {
    logEntries.push(`[Odds Sync] Querying Manifold Markets API for 2026 US Midterm contracts...`);
    
    // Search terms targeting 2026 elections
    const searchQueries = [
      '2026 Senate',
      '2026 Senate election',
      '2026 House elections',
      '2026 Texas Senate',
      '2026 Maine Senate',
      'Republicans win Senate 2026'
    ];

    const marketMap = new Map();

    for (const term of searchQueries) {
      const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(term)}&limit=15`;
      const res = await fetch(url, { headers: { 'User-Agent': 'USMidtermPWA/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      
      for (const m of data) {
        if (!marketMap.has(m.id)) {
          marketMap.set(m.id, m);
        }
      }
    }

    logEntries.push(`[Odds Sync] Discovered ${marketMap.size} relevant prediction market contracts.`);

    // Process key battleground and national contracts
    for (const [id, m] of marketMap) {
      if (typeof m.probability !== 'number' || isNaN(m.probability)) continue;
      const q = (m.question || '').toLowerCase();
      let raceId = null;
      let demProb = null;
      let repProb = null;

      // National Senate Control
      if (q.includes('republicans win the senate in the 2026') || q.includes('republican senate majority 2026')) {
        raceId = 'senate-national';
        repProb = Number((m.probability * 100).toFixed(1));
        demProb = Number(((1 - m.probability) * 100).toFixed(1));
      } else if (q.includes('democrats win the senate in the 2026')) {
        raceId = 'senate-national';
        demProb = Number((m.probability * 100).toFixed(1));
        repProb = Number(((1 - m.probability) * 100).toFixed(1));
      }
      // National House Control
      else if (q.includes('democrats win the house in 2026') || q.includes('democratic house majority 2026')) {
        raceId = 'house-national';
        demProb = Number((m.probability * 100).toFixed(1));
        repProb = Number(((1 - m.probability) * 100).toFixed(1));
      } else if (q.includes('republicans win the house in 2026')) {
        raceId = 'house-national';
        repProb = Number((m.probability * 100).toFixed(1));
        demProb = Number(((1 - m.probability) * 100).toFixed(1));
      }
      // Key Senate States
      else if (q.includes('texas senate') || q.includes('texas 2026 senate')) {
        raceId = 'senate-tx';
        if (q.includes('democrat')) {
          demProb = Number((m.probability * 100).toFixed(1));
          repProb = Number(((1 - m.probability) * 100).toFixed(1));
        } else if (q.includes('republican') || q.includes('gop')) {
          repProb = Number((m.probability * 100).toFixed(1));
          demProb = Number(((1 - m.probability) * 100).toFixed(1));
        }
      } else if (q.includes('maine') && q.includes('senate')) {
        raceId = 'senate-me';
        if (q.includes('democrat') || q.includes('troy jackson')) {
          demProb = Number((m.probability * 100).toFixed(1));
          repProb = Number(((1 - m.probability) * 100).toFixed(1));
        } else if (q.includes('susan collins') || q.includes('republican')) {
          repProb = Number((m.probability * 100).toFixed(1));
          demProb = Number(((1 - m.probability) * 100).toFixed(1));
        }
      } else if (q.includes('georgia') && q.includes('senate')) {
        raceId = 'senate-ga';
        if (q.includes('democrat')) {
          demProb = Number((m.probability * 100).toFixed(1));
          repProb = Number(((1 - m.probability) * 100).toFixed(1));
        } else if (q.includes('republican')) {
          repProb = Number((m.probability * 100).toFixed(1));
          demProb = Number(((1 - m.probability) * 100).toFixed(1));
        }
      } else if (q.includes('michigan') && q.includes('senate')) {
        raceId = 'senate-mi';
        if (q.includes('democrat')) {
          demProb = Number((m.probability * 100).toFixed(1));
          repProb = Number(((1 - m.probability) * 100).toFixed(1));
        } else if (q.includes('republican')) {
          repProb = Number((m.probability * 100).toFixed(1));
          demProb = Number(((1 - m.probability) * 100).toFixed(1));
        }
      } else if (q.includes('north carolina') && q.includes('senate')) {
        raceId = 'senate-nc';
        if (q.includes('democrat')) {
          demProb = Number((m.probability * 100).toFixed(1));
          repProb = Number(((1 - m.probability) * 100).toFixed(1));
        } else if (q.includes('republican')) {
          repProb = Number((m.probability * 100).toFixed(1));
          demProb = Number(((1 - m.probability) * 100).toFixed(1));
        }
      }

      if (raceId && demProb !== null && repProb !== null) {
        const stateCode = raceId.includes('national') ? 'US' : (raceId.split('-')[1]?.toUpperCase() || 'US');
        await execute(`
          INSERT INTO races (id, chamber, state_code, title, dem_win_prob, rep_win_prob, is_battleground, rating)
          VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)
          ON DUPLICATE KEY UPDATE 
            dem_win_prob = CASE WHEN is_prob_overridden = TRUE THEN dem_win_prob ELSE VALUES(dem_win_prob) END,
            rep_win_prob = CASE WHEN is_prob_overridden = TRUE THEN rep_win_prob ELSE VALUES(rep_win_prob) END;
        `, [
          raceId, 
          raceId.startsWith('senate') ? 'senate' : 'house',
          stateCode,
          `2026 ${raceId.toUpperCase()} Race`,
          demProb,
          repProb,
          Math.abs(demProb - repProb) < 10 ? 'tossup' : demProb > repProb ? 'lean_d' : 'lean_r'
        ]);

        // Record time-series snapshot for historical trendline
        await execute(`
          INSERT INTO odds_snapshots (race_id, source, dem_prob, rep_prob)
          VALUES (?, 'manifold', ?, ?);
        `, [raceId, demProb, repProb]);

        recordsUpdated++;
        logEntries.push(`[Odds Update] ${raceId}: Dem ${demProb}% vs Rep ${repProb}% (from "${m.question.slice(0, 40)}...")`);
      }
    }

    logEntries.push(`[Odds Sync Complete] Successfully updated ${recordsUpdated} race probabilities.`);
    return { success: true, recordsUpdated, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[Odds Sync Error] ${err.message}`);
    return { success: false, recordsUpdated, logs: logEntries.join('\n'), error: err.message };
  }
}
