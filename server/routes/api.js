import express from 'express';
import { query, execute } from '../db/db.js';
import { runJob } from '../jobs/scheduler.js';

const router = express.Router();

// ==========================================
// PUBLIC API ENDPOINTS
// ==========================================

// 1. National Overview & Balance of Power
router.get('/overview', async (req, res) => {
  try {
    const races = await query(`SELECT * FROM races;`);
    const candidates = await query(`SELECT * FROM candidates;`);
    const latestNews = await query(`
      SELECT * FROM news_articles 
      WHERE is_hidden = FALSE 
      ORDER BY is_pinned DESC, published_at DESC 
      LIMIT 6;
    `);

    // Calculate Senate balance
    const senateRaces = races.filter(r => r.chamber === 'senate');
    const houseRaces = races.filter(r => r.chamber === 'house');

    const nationalSenate = races.find(r => r.id === 'senate-national') || { dem_win_prob: 48.5, rep_win_prob: 51.5 };
    const nationalHouse = races.find(r => r.id === 'house-national') || { dem_win_prob: 52.0, rep_win_prob: 48.0 };

    res.json({
      timestamp: new Date().toISOString(),
      national: {
        senate: {
          demProb: nationalSenate.dem_win_prob || 49.0,
          repProb: nationalSenate.rep_win_prob || 51.0,
          totalContested: senateRaces.length,
          tossups: senateRaces.filter(r => r.rating === 'tossup' || r.is_battleground).length
        },
        house: {
          demProb: nationalHouse.dem_win_prob || 52.0,
          repProb: nationalHouse.rep_win_prob || 48.0,
          totalContested: 435,
          tossups: houseRaces.filter(r => r.rating === 'tossup').length || 24
        }
      },
      topBattlegrounds: races.filter(r => r.is_battleground).slice(0, 8),
      breakingNews: latestNews,
      totalCandidates: candidates.length,
      totalRaces: races.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Races List (Filterable)
router.get('/races', async (req, res) => {
  try {
    const { chamber, state, battleground } = req.query;
    let sql = `SELECT * FROM races WHERE 1=1`;
    const params = [];

    if (chamber) {
      sql += ` AND chamber = ?`;
      params.push(chamber);
    }
    if (state) {
      sql += ` AND state_code = ?`;
      params.push(state.toUpperCase());
    }
    if (battleground === 'true') {
      sql += ` AND is_battleground = TRUE`;
    }

    sql += ` ORDER BY is_battleground DESC, state_code ASC;`;
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Race Details with Candidates & Odds History
router.get('/races/:id', async (req, res) => {
  try {
    const [race] = await query(`SELECT * FROM races WHERE id = ?;`, [req.params.id]);
    if (!race) {
      return res.status(404).json({ error: 'Race not found' });
    }

    const candidates = await query(`SELECT * FROM candidates WHERE race_id = ? ORDER BY is_incumbent DESC, full_name ASC;`, [race.id]);
    const oddsHistory = await query(`
      SELECT source, dem_prob, rep_prob, recorded_at 
      FROM odds_snapshots 
      WHERE race_id = ? 
      ORDER BY recorded_at ASC 
      LIMIT 100;
    `, [race.id]);

    const localNews = await query(`
      SELECT * FROM news_articles 
      WHERE (tagged_state = ? OR tagged_chamber = ?) AND is_hidden = FALSE 
      ORDER BY published_at DESC 
      LIMIT 5;
    `, [race.state_code, race.chamber]);

    // Structured FAQ for Google Rich Snippets & AI Search Extraction
    const faqs = [
      {
        question: `Who is running in the ${race.title}?`,
        answer: candidates.length > 0
          ? `Candidates running include ${candidates.map(c => `${c.full_name} (${c.party}${c.is_incumbent ? ', Incumbent' : ''})`).join(', ')}.`
          : `Candidate filings are currently being certified by election officials.`
      },
      {
        question: `What are the current win odds for ${race.title}?`,
        answer: `As of the latest prediction market aggregates, Democrats stand at ${race.dem_win_prob || 50}% and Republicans at ${race.rep_win_prob || 50}%. Race rating: ${race.rating?.replace('_', ' ').toUpperCase()}.`
      }
    ];

    res.json({
      race,
      candidates,
      oddsHistory,
      localNews,
      faqs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Candidates Directory & Search
router.get('/candidates', async (req, res) => {
  try {
    const { q, party, state } = req.query;
    let sql = `SELECT c.*, r.title as race_title, r.chamber, r.state_code FROM candidates c JOIN races r ON c.race_id = r.id WHERE 1=1`;
    const params = [];

    if (q) {
      sql += ` AND (c.full_name LIKE ? OR c.party LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    if (party) {
      sql += ` AND c.party = ?`;
      params.push(party);
    }
    if (state) {
      sql += ` AND r.state_code = ?`;
      params.push(state.toUpperCase());
    }

    sql += ` ORDER BY c.is_incumbent DESC, c.full_name ASC LIMIT 100;`;
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Live News Feed
router.get('/news', async (req, res) => {
  try {
    const { state, chamber, limit } = req.query;
    let sql = `SELECT * FROM news_articles WHERE is_hidden = FALSE`;
    const params = [];

    if (state) {
      sql += ` AND tagged_state = ?`;
      params.push(state.toUpperCase());
    }
    if (chamber) {
      sql += ` AND tagged_chamber = ?`;
      params.push(chamber);
    }

    sql += ` ORDER BY is_pinned DESC, published_at DESC LIMIT ?;`;
    params.push(parseInt(limit || '30', 10));

    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Global SEO & Site Metadata
router.get('/seo', async (req, res) => {
  try {
    const configRows = await query(`SELECT config_key, config_value FROM site_config;`);
    const config = {};
    for (const row of configRows) {
      config[row.config_key] = row.config_value;
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN API ENDPOINTS
// ==========================================

// Simple bearer / secret auth guard
const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const secret = process.env.ADMIN_SECRET_KEY || 'Midterm2026!AdminSec#';
  if (authHeader && authHeader === `Bearer ${secret}`) {
    return next();
  }
  // Also support session/query token for admin convenience
  if (req.query.token === secret) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized admin access' });
};

// 7. Get Jobs Status
router.get('/admin/jobs', requireAdmin, async (req, res) => {
  try {
    const jobs = await query(`SELECT * FROM jobs ORDER BY schedule_interval_mins ASC;`);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Trigger Job Manually
router.post('/admin/jobs/:jobId/run', requireAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await runJob(jobId);
    res.json({ message: `Job ${jobId} triggered successfully`, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Update Job Schedule & Enable Toggle
router.patch('/admin/jobs/:jobId', requireAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { schedule_interval_mins, is_enabled } = req.body;

    await execute(`
      UPDATE jobs 
      SET schedule_interval_mins = COALESCE(?, schedule_interval_mins),
          is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?;
    `, [schedule_interval_mins, is_enabled, jobId]);

    res.json({ message: `Job ${jobId} updated successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Audit Logs
router.get('/admin/jobs/logs', requireAdmin, async (req, res) => {
  try {
    const logs = await query(`
      SELECT * FROM job_audit_logs 
      ORDER BY started_at DESC 
      LIMIT 100;
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Admin Candidate Update
router.put('/admin/candidates/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, party, is_incumbent, photo_url, bio_snippet, campaign_website, prob_override } = req.body;

    await execute(`
      UPDATE candidates 
      SET full_name = COALESCE(?, full_name),
          party = COALESCE(?, party),
          is_incumbent = COALESCE(?, is_incumbent),
          photo_url = COALESCE(?, photo_url),
          bio_snippet = COALESCE(?, bio_snippet),
          campaign_website = COALESCE(?, campaign_website),
          prob_override = ?
      WHERE id = ?;
    `, [full_name, party, is_incumbent, photo_url, bio_snippet, campaign_website, prob_override, id]);

    res.json({ message: `Candidate ${id} updated successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Admin Race Override (Probability or Rating)
router.put('/admin/races/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { dem_win_prob, rep_win_prob, rating, is_battleground, is_prob_overridden } = req.body;

    await execute(`
      UPDATE races 
      SET dem_win_prob = COALESCE(?, dem_win_prob),
          rep_win_prob = COALESCE(?, rep_win_prob),
          rating = COALESCE(?, rating),
          is_battleground = COALESCE(?, is_battleground),
          is_prob_overridden = COALESCE(?, is_prob_overridden)
      WHERE id = ?;
    `, [dem_win_prob, rep_win_prob, rating, is_battleground, is_prob_overridden, id]);

    res.json({ message: `Race ${id} updated successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Admin News Moderation
router.patch('/admin/news/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_pinned, is_hidden } = req.body;

    await execute(`
      UPDATE news_articles 
      SET is_pinned = COALESCE(?, is_pinned),
          is_hidden = COALESCE(?, is_hidden)
      WHERE id = ?;
    `, [is_pinned, is_hidden, id]);

    res.json({ message: `News article ${id} updated` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Admin Site Config & SEO Update
router.put('/admin/config', requireAdmin, async (req, res) => {
  try {
    const updates = req.body; // e.g. { site_title: "...", meta_description: "..." }
    for (const [key, val] of Object.entries(updates)) {
      await execute(`
        INSERT INTO site_config (config_key, config_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
      `, [key, val]);
    }
    res.json({ message: 'Site configuration updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
