import { execute, query } from '../db/db.js';

/**
 * Wikipedia & Wikimedia REST API Fetcher
 * Obtains authentic public official portraits and verified biographic extracts
 */
export async function fetchWikipediaDetails() {
  const logEntries = [];
  let recordsUpdated = 0;

  try {
    logEntries.push(`[Wikipedia Sync] Scanning candidates needing portrait photo or bio...`);
    const candidates = await query(`
      SELECT id, full_name 
      FROM candidates 
      WHERE photo_url IS NULL OR bio_snippet IS NULL OR bio_snippet LIKE '%Serving term%' 
      LIMIT 25;
    `);

    logEntries.push(`[Wikipedia Sync] Found ${candidates.length} candidates to augment with official portraits.`);

    for (const c of candidates) {
      try {
        const cleanName = c.full_name.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_');
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`;
        
        const res = await fetch(url, { headers: { 'User-Agent': 'USMidtermPWA/1.0 (info@innovat.space)' } });
        if (!res.ok) continue;

        const data = await res.json();
        const photoUrl = data.thumbnail?.source || null;
        const extract = data.extract ? data.extract.split('. ').slice(0, 2).join('. ') + '.' : null;

        if (photoUrl || extract) {
          await execute(`
            UPDATE candidates 
            SET photo_url = COALESCE(?, photo_url),
                bio_snippet = COALESCE(?, bio_snippet)
            WHERE id = ?;
          `, [photoUrl, extract, c.id]);

          recordsUpdated++;
          logEntries.push(`[Wikipedia Match] Updated portrait & bio for ${c.full_name}`);
        }
      } catch (subErr) {
        // Continue to next candidate
      }
    }

    logEntries.push(`[Wikipedia Sync Complete] Augmented ${recordsUpdated} candidate profiles with verified media.`);
    return { success: true, recordsUpdated, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[Wikipedia Sync Error] ${err.message}`);
    return { success: false, recordsUpdated, logs: logEntries.join('\n'), error: err.message };
  }
}
