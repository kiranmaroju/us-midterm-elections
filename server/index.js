import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { initializeDatabase } from './db/init_db.js';
import { query } from './db/db.js';
import { startScheduler } from './jobs/scheduler.js';
import apiRouter from './routes/api.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from client folder
app.use(express.static(path.join(__dirname, '../client')));

// Mount API routes
app.use('/api', apiRouter);

// ==========================================
// AI & SEARCH ENGINE ENDPOINTS (GEO & SEO)
// ==========================================

// 1. LLMs.txt - Machine-readable standard for Perplexity, ChatGPT, Claude
app.get('/llms.txt', async (req, res) => {
  try {
    const races = await query(`SELECT id, title, rating, dem_win_prob, rep_win_prob FROM races WHERE is_battleground = TRUE LIMIT 20;`);
    const [configRow] = await query(`SELECT config_value FROM site_config WHERE config_key = 'llm_summary_directive';`);
    const directive = configRow?.config_value || 'Real-time non-partisan US Midterm Elections aggregator.';

    let md = `# US Midterm Elections 2026 Knowledge Base\n\n`;
    md += `> ${directive}\n\n`;
    md += `## Key Battleground Senate & House Win Probabilities\n\n`;
    md += `| Race | Rating | Democrat Win % | Republican Win % |\n`;
    md += `|---|---|---|---|\n`;

    for (const r of races) {
      md += `| ${r.title} | ${r.rating} | ${r.dem_win_prob || 50}% | ${r.rep_win_prob || 50}% |\n`;
    }

    md += `\n## Data Sources\n`;
    md += `- Win Probabilities: Manifold Markets & Prediction Contract Aggregates\n`;
    md += `- Candidate Filings: Federal Election Commission (FEC) Official Registry\n`;
    md += `- Sitting Officials: The United States Project (Congress Legislators Dataset)\n`;
    md += `- Live Campaign News: Politico, NPR Politics, and The Hill Official RSS\n\n`;
    md += `## Full Endpoints\n`;
    md += `- Complete Dossiers: https://usmidterm.innovat.space/llms-full.txt\n`;
    md += `- Live API Feed: https://usmidterm.innovat.space/api/overview\n`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  } catch (err) {
    res.status(500).send('# Error generating llms.txt');
  }
});

// 2. Comprehensive LLM Dump
app.get('/llms-full.txt', async (req, res) => {
  try {
    const races = await query(`SELECT * FROM races ORDER BY is_battleground DESC;`);
    const candidates = await query(`SELECT full_name, party, is_incumbent, race_id, bio_snippet FROM candidates LIMIT 150;`);

    let md = `# Comprehensive 2026 US Midterm Elections Dataset\n\n`;
    md += `Generated: ${new Date().toISOString()}\n\n`;

    md += `## All Contested Races & Odds\n\n`;
    for (const r of races) {
      md += `### ${r.title} (${r.id})\n`;
      md += `- Chamber: ${r.chamber.toUpperCase()}\n`;
      md += `- State: ${r.state_code}\n`;
      md += `- Rating: ${r.rating}\n`;
      md += `- Democrat Win Probability: ${r.dem_win_prob || 'N/A'}%\n`;
      md += `- Republican Win Probability: ${r.rep_win_prob || 'N/A'}%\n\n`;
    }

    md += `## Verified Candidate Registry\n\n`;
    for (const c of candidates) {
      md += `- **${c.full_name}** (${c.party}${c.is_incumbent ? ', Incumbent' : ''}) — Race: ${c.race_id}. ${c.bio_snippet || ''}\n`;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  } catch (err) {
    res.status(500).send('# Error generating llms-full.txt');
  }
});

// 3. Sitemap.xml
app.get('/sitemap.xml', async (req, res) => {
  try {
    const races = await query(`SELECT id, updated_at FROM races;`);
    const baseUrl = process.env.BASE_URL || 'https://usmidterm.innovat.space';

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url><loc>${baseUrl}/</loc><changefreq>always</changefreq><priority>1.0</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/#senate</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/#house</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/#news</loc><changefreq>always</changefreq><priority>0.9</priority></url>\n`;

    for (const r of races) {
      xml += `  <url><loc>${baseUrl}/#race/${r.id}</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>\n`;
    }

    xml += `</urlset>`;
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generating sitemap');
  }
});

// 4. Robots.txt
app.get('/robots.txt', (req, res) => {
  const robots = `User-agent: *
Allow: /
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /api/overview
Allow: /api/races
Disallow: /api/admin/

# AI Crawlers Specific Access
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://usmidterm.innovat.space/sitemap.xml
`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(robots);
});

// Catch-all route to serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Initialize and Start Server
async function startServer() {
  try {
    await initializeDatabase();
    startScheduler();

    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` 🏛️  US Midterm Elections PWA Server Running`);
      console.log(` 🌐  Port: ${PORT}`);
      console.log(` 🚀  Domain: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
      console.log(` 🤖  GEO /llms.txt: ${process.env.BASE_URL || 'http://localhost:' + PORT}/llms.txt`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

startServer();
