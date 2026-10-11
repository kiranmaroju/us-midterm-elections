import { execute, query } from '../db/db.js';

/**
 * Open FEC Candidate Filings Fetcher
 * Official United States Federal Election Commission API
 */
export async function fetchFecCandidates() {
  const logEntries = [];
  let recordsAdded = 0;
  let recordsUpdated = 0;

  try {
    const apiKey = process.env.FEC_API_KEY || 'DEMO_KEY';
    logEntries.push(`[FEC Sync] Connecting to api.open.fec.gov for 2026 candidate filings...`);

    // Fetch key Senate and House contenders
    const url = `https://api.open.fec.gov/v1/candidates/?api_key=${apiKey}&election_year=2026&per_page=60`;
    const res = await fetch(url, { headers: { 'User-Agent': 'USMidtermApp/1.0' } });

    if (!res.ok) {
      throw new Error(`FEC API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = data.results || [];
    logEntries.push(`[FEC Sync] Retrieved ${results.length} active candidates filed for 2026.`);

    for (const cand of results) {
      if (!cand.state || !cand.office) continue;

      const stateCode = cand.state.toUpperCase();
      const officeType = cand.office.toLowerCase(); // 's' = senate, 'h' = house
      const chamber = officeType === 's' ? 'senate' : 'house';
      const district = cand.district ? parseInt(cand.district, 10) : null;
      const raceId = chamber === 'senate' ? `senate-${stateCode.toLowerCase()}` : `house-${stateCode.toLowerCase()}-${district || 1}`;

      const partyRaw = (cand.party_full || cand.party || '').toUpperCase();
      const party = partyRaw.includes('DEMOCRAT') ? 'Democrat' : partyRaw.includes('REPUBLICAN') ? 'Republican' : 'Independent';
      const candidateId = `fec-${cand.candidate_id}`;

      // Normalize candidate name (e.g., "CORNEN, JOHN" -> "John Cornyn")
      const nameParts = (cand.name || '').split(',');
      const fullName = nameParts.length === 2 
        ? `${nameParts[1].trim()} ${nameParts[0].trim()}` 
        : cand.name;

      // Upsert candidate record
      await execute(`
        INSERT INTO candidates (id, race_id, full_name, party, is_incumbent, fec_id, is_incumbent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          party = VALUES(party),
          fec_id = VALUES(fec_id);
      `, [
        candidateId,
        raceId,
        fullName,
        party,
        cand.incumbent_challenge_full === 'Incumbent',
        cand.candidate_id,
        cand.incumbent_challenge_full === 'Incumbent'
      ]);

      recordsUpdated++;
    }

    logEntries.push(`[FEC Sync Complete] Reconciled ${recordsUpdated} candidates with Federal Election Commission filings.`);
    return { success: true, recordsAdded, recordsUpdated, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[FEC Sync Error] ${err.message}`);
    return { success: false, recordsAdded, recordsUpdated, logs: logEntries.join('\n'), error: err.message };
  }
}
