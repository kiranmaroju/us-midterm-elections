import yaml from 'js-yaml';
import { execute, query } from '../db/db.js';

/**
 * United States Congress Civic Dataset Fetcher
 * Parses 535 members of Congress from github: unitedstates/congress-legislators
 */
export async function fetchCongressLegislators() {
  const logEntries = [];
  let recordsAdded = 0;
  let recordsUpdated = 0;

  try {
    logEntries.push(`[Congress Sync] Downloading official legislators-current.yaml...`);
    const res = await fetch('https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml', {
      headers: { 'User-Agent': 'USMidtermApp/1.0' }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch congress legislators: HTTP ${res.status}`);
    }

    const text = await res.text();
    const legislators = yaml.load(text);
    logEntries.push(`[Congress Sync] Successfully parsed ${legislators.length} members of Congress.`);

    for (const leg of legislators) {
      const currentTerm = leg.terms[leg.terms.length - 1];
      if (!currentTerm) continue;

      const isSenate = currentTerm.type === 'sen';
      const isHouse = currentTerm.type === 'rep';
      const termEndYear = new Date(currentTerm.end).getFullYear();

      // Filter for 2026/2027 expiration (Senate Class II seats & House seats)
      if (isSenate && (currentTerm.class === 2 || termEndYear === 2027)) {
        const stateCode = currentTerm.state.toUpperCase();
        const raceId = `senate-${stateCode.toLowerCase()}`;
        const raceTitle = `2026 ${stateCode} US Senate Election`;
        const party = currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party === 'Republican' ? 'Republican' : 'Independent';
        const candidateId = `leg-${leg.id.bioguide}`;
        const fullName = `${leg.name.first} ${leg.name.last}`;
        const bioguideId = leg.id.bioguide;
        const fecId = (leg.id.fec && leg.id.fec[0]) || null;
        const wikipediaTitle = leg.id.wikipedia || `${leg.name.first} ${leg.name.last}`;

        // Upsert Race
        await execute(`
          INSERT INTO races (id, chamber, state_code, title, rating, current_holder_party, is_battleground)
          VALUES (?, 'senate', ?, ?, 'tossup', ?, ?)
          ON DUPLICATE KEY UPDATE 
            current_holder_party = VALUES(current_holder_party);
        `, [
          raceId,
          stateCode,
          raceTitle,
          party,
          ['ME', 'TX', 'MI', 'GA', 'NC', 'AZ', 'PA', 'OH', 'WI', 'NV'].includes(stateCode)
        ]);

        // Upsert Candidate (Incumbent)
        await execute(`
          INSERT INTO candidates (id, race_id, full_name, first_name, last_name, party, is_incumbent, fec_id, bioguide_id, bio_snippet, campaign_website)
          VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            is_incumbent = TRUE,
            party = VALUES(party),
            bioguide_id = VALUES(bioguide_id);
        `, [
          candidateId,
          raceId,
          fullName,
          leg.name.first,
          leg.name.last,
          party,
          fecId,
          bioguideId,
          `Incumbent US Senator representing ${stateCode}. Serving term expiring in 2027.`,
          currentTerm.url || `https://www.senate.gov`
        ]);

        recordsUpdated++;
      }
      // Also register key Battleground House seats
      else if (isHouse && ['CA', 'NY', 'PA', 'TX', 'MI', 'AZ', 'OH', 'NC', 'FL'].includes(currentTerm.state)) {
        const stateCode = currentTerm.state.toUpperCase();
        const district = currentTerm.district;
        const raceId = `house-${stateCode.toLowerCase()}-${district}`;
        const party = currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party === 'Republican' ? 'Republican' : 'Independent';
        const candidateId = `leg-${leg.id.bioguide}`;
        const fullName = `${leg.name.first} ${leg.name.last}`;

        await execute(`
          INSERT INTO races (id, chamber, state_code, district_num, title, rating, current_holder_party, is_battleground)
          VALUES (?, 'house', ?, ?, ?, 'tossup', ?, FALSE)
          ON DUPLICATE KEY UPDATE 
            current_holder_party = VALUES(current_holder_party);
        `, [
          raceId,
          stateCode,
          district,
          `${stateCode}-${district} Congressional District`,
          party
        ]);

        await execute(`
          INSERT INTO candidates (id, race_id, full_name, first_name, last_name, party, is_incumbent, fec_id, bioguide_id, bio_snippet)
          VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            is_incumbent = TRUE,
            party = VALUES(party);
        `, [
          candidateId,
          raceId,
          fullName,
          leg.name.first,
          leg.name.last,
          party,
          (leg.id.fec && leg.id.fec[0]) || null,
          leg.id.bioguide,
          `Incumbent US Representative for ${stateCode}'s ${district}th Congressional District.`
        ]);

        recordsAdded++;
      }
    }

    logEntries.push(`[Congress Sync Complete] Processed ${recordsUpdated} Senate incumbents & ${recordsAdded} House seats.`);
    return { success: true, recordsAdded, recordsUpdated, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[Congress Sync Error] ${err.message}`);
    return { success: false, recordsAdded, recordsUpdated, logs: logEntries.join('\n'), error: err.message };
  }
}
