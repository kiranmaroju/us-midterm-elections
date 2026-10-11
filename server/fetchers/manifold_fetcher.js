import { execute, query } from '../db/db.js';

/**
 * Manifold Markets Real-Time Win Probabilities Fetcher
 * Authentic, free, zero-authentication prediction market API
 * Ingests all 33 Class II Senate battlegrounds, national control, and House races.
 */

const CLASS_II_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CO', name: 'Colorado' }, { code: 'DE', name: 'Delaware' }, { code: 'GA', name: 'Georgia' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NC', name: 'North Carolina' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'VA', name: 'Virginia' }, { code: 'WV', name: 'West Virginia' }, { code: 'WY', name: 'Wyoming' }
];

function isCleanGeneralElectionQuestion(q) {
  const ql = q.toLowerCase();
  // Filter out primary, runoff, county-specific, margin, and conditional markets
  if (ql.includes('primary') || ql.includes('runoff') || ql.includes('county') || 
      ql.includes('margin') || ql.includes('by 8.00%') || ql.includes('by 9%') || 
      ql.includes('outperform') || ql.includes('drop out') || ql.includes('if this person') || 
      ql.includes('before eoy') || ql.includes('how many seats') || ql.includes('gop primary') ||
      ql.includes('dem primary') || ql.includes('first round')) {
    return false;
  }
  return true;
}

function calculateRating(demProb, repProb) {
  if (demProb === null || repProb === null) return 'tossup';
  if (demProb >= 75) return 'solid_d';
  if (demProb >= 60) return 'lean_d';
  if (repProb >= 75) return 'solid_r';
  if (repProb >= 60) return 'lean_r';
  return 'tossup';
}

export async function fetchManifoldOdds() {
  const logEntries = [];
  let recordsUpdated = 0;

  try {
    logEntries.push(`[Odds Sync] Querying Manifold Markets API for authentic 2026 Midterm contracts...`);

    // 1. National Control Markets (Senate & House)
    const nationalQueries = [
      'Will Republicans win the Senate in the 2026 elections?',
      'Will the Democrats win a majority in the House of Representatives in the 2026 elections?',
      '2026 Senate majority'
    ];

    for (const nq of nationalQueries) {
      try {
        const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(nq)}&limit=5`;
        const res = await fetch(url, { headers: { 'User-Agent': 'USMidtermPWA/1.0' } });
        if (!res.ok) continue;
        const markets = await res.json();
        for (const m of markets) {
          const q = (m.question || '').toLowerCase();
          if (m.outcomeType === 'BINARY' && typeof m.probability === 'number') {
            if (q.includes('republicans win the senate in the 2026') || q.includes('republican senate majority 2026')) {
              const rep = Number((m.probability * 100).toFixed(1));
              const dem = Number(((1 - m.probability) * 100).toFixed(1));
              await saveRaceOdds('senate-national', 'US', '2026 National US Senate Balance', dem, rep, m.question);
              recordsUpdated++;
            } else if (q.includes('democrats win a majority in the house') || q.includes('democratic house majority 2026')) {
              const dem = Number((m.probability * 100).toFixed(1));
              const rep = Number(((1 - m.probability) * 100).toFixed(1));
              await saveRaceOdds('house-national', 'US', '2026 National US House Balance', dem, rep, m.question);
              recordsUpdated++;
            }
          }
        }
      } catch (e) {
        logEntries.push(`[Odds Sync Warn] National query ${nq}: ${e.message}`);
      }
    }

    // 2. State-by-State Senate Markets for all 33 Class II States
    for (const st of CLASS_II_STATES) {
      const raceId = `senate-${st.code.toLowerCase()}`;
      try {
        const searchUrl = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(`2026 ${st.name} Senate`)}&limit=10`;
        const res = await fetch(searchUrl, { headers: { 'User-Agent': 'USMidtermPWA/1.0' } });
        if (!res.ok) continue;
        const data = await res.json();

        let matchFound = false;

        for (const m of data) {
          const q = m.question || '';
          if (!isCleanGeneralElectionQuestion(q)) continue;
          if (!q.includes('2026') || (!q.toLowerCase().includes('senate') && !q.toLowerCase().includes('senator'))) continue;

          let demProb = null;
          let repProb = null;

          if (m.outcomeType === 'MULTIPLE_CHOICE') {
            // Fetch detailed answers
            const detRes = await fetch(`https://api.manifold.markets/v0/market/${m.id}`, { headers: { 'User-Agent': 'USMidtermPWA/1.0' } });
            if (!detRes.ok) continue;
            const det = await detRes.json();
            const answers = det.answers || [];

            let rawDem = 0;
            let rawRep = 0;

            for (const a of answers) {
              const txt = (a.text || '').toLowerCase();
              const p = a.probability || 0;
              if (txt.includes('democrat') || txt.includes('troy jackson') || txt.includes('peltola') || 
                  txt.includes('el-sayed') || txt.includes('talarico') || txt.includes('hickenlooper') || 
                  txt.includes('cooper') || txt.includes('pappas') || txt.includes('turek') || txt.includes('markey') ||
                  txt.includes('flanagan')) {
                rawDem += p;
              } else if (txt.includes('republican') || txt.includes('collins') || txt.includes('sullivan') || 
                         txt.includes('rogers') || txt.includes('paxton') || txt.includes('alme') || 
                         txt.includes('risch') || txt.includes('hinson') || txt.includes('barr') || 
                         txt.includes('cornyn') || txt.includes('sununu') || txt.includes('dan osborn')) {
                rawRep += p;
              }
            }

            const total = rawDem + rawRep;
            if (total > 0.05) {
              demProb = Number(((rawDem / total) * 100).toFixed(1));
              repProb = Number(((rawRep / total) * 100).toFixed(1));
            }
          } else if (m.outcomeType === 'BINARY' && typeof m.probability === 'number') {
            const ql = q.toLowerCase();
            if (ql.includes('democrat') || ql.includes('troy jackson') || ql.includes('roy cooper') || ql.includes('jon ossoff')) {
              demProb = Number((m.probability * 100).toFixed(1));
              repProb = Number(((1 - m.probability) * 100).toFixed(1));
            } else if (ql.includes('republican') || ql.includes('susan collins') || ql.includes('dan sullivan')) {
              repProb = Number((m.probability * 100).toFixed(1));
              demProb = Number(((1 - m.probability) * 100).toFixed(1));
            }
          }

          if (demProb !== null && repProb !== null) {
            await saveRaceOdds(raceId, st.code, `2026 ${st.code} US Senate Election`, demProb, repProb, q);
            recordsUpdated++;
            matchFound = true;
            logEntries.push(`[Odds Update] ${st.code}: Dem ${demProb}% vs Rep ${repProb}% (from "${q.slice(0, 45)}...")`);
            break; // Used best matching general election contract
          }
        }

        if (!matchFound) {
          logEntries.push(`[Odds Pending] ${st.code}: No active binary general election contract found on Manifold.`);
        }

      } catch (stErr) {
        logEntries.push(`[Odds Warn] ${st.code}: ${stErr.message}`);
      }
    }

    logEntries.push(`[Odds Sync Complete] Successfully synchronized ${recordsUpdated} authentic race odds from prediction markets.`);
    return { success: true, recordsUpdated, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[Odds Sync Error] ${err.message}`);
    return { success: false, recordsUpdated, logs: logEntries.join('\n'), error: err.message };
  }
}

async function saveRaceOdds(raceId, stateCode, title, demProb, repProb, question) {
  const rating = calculateRating(demProb, repProb);
  const isBattleground = (rating === 'tossup' || rating === 'lean_d' || rating === 'lean_r') ? 1 : 0;
  const chamber = raceId.startsWith('house') ? 'house' : 'senate';

  await execute(`
    INSERT INTO races (id, chamber, state_code, title, dem_win_prob, rep_win_prob, is_battleground, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      dem_win_prob = CASE WHEN is_prob_overridden = TRUE THEN dem_win_prob ELSE VALUES(dem_win_prob) END,
      rep_win_prob = CASE WHEN is_prob_overridden = TRUE THEN rep_win_prob ELSE VALUES(rep_win_prob) END,
      rating = CASE WHEN is_prob_overridden = TRUE THEN rating ELSE VALUES(rating) END,
      is_battleground = CASE WHEN is_prob_overridden = TRUE THEN is_battleground ELSE VALUES(is_battleground) END,
      updated_at = CURRENT_TIMESTAMP;
  `, [raceId, chamber, stateCode, title, demProb, repProb, isBattleground, rating]);

  // Insert time-series snapshot
  await execute(`
    INSERT INTO odds_snapshots (race_id, source, dem_prob, rep_prob, details)
    VALUES (?, 'manifold', ?, ?, ?);
  `, [raceId, demProb, repProb, question || null]);
}
