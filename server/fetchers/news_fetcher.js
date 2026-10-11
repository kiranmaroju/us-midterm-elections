import xml2js from 'xml2js';
import crypto from 'crypto';
import { execute, query } from '../db/db.js';

/**
 * Real-Time Political News RSS Aggregator
 * Concurrently ingests Politico, NPR Politics, and The Hill RSS feeds
 */
export async function fetchLiveNews() {
  const logEntries = [];
  let recordsAdded = 0;

  const feeds = [
    { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml' },
    { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'The Hill', url: 'https://thehill.com/feed/' }
  ];

  const stateKeywords = {
    'PA': ['pennsylvania', 'pa senate', 'keystone'],
    'GA': ['georgia', 'ga senate', 'atlanta'],
    'TX': ['texas', 'tx senate', 'cornyn'],
    'ME': ['maine', 'me senate', 'collins'],
    'MI': ['michigan', 'mi senate'],
    'NC': ['north carolina', 'nc senate'],
    'AZ': ['arizona', 'az senate'],
    'WI': ['wisconsin', 'wi senate'],
    'NV': ['nevada', 'nv senate'],
    'OH': ['ohio', 'oh senate']
  };

  try {
    logEntries.push(`[News Sync] Fetching live feeds from Politico, NPR, and The Hill...`);

    for (const feed of feeds) {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) USMidtermNews/1.0' }
        });

        if (!res.ok) {
          logEntries.push(`[News Sync Warn] ${feed.name} returned HTTP ${res.status}`);
          continue;
        }

        const xml = await res.text();
        const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, trim: true });
        const items = parsed?.rss?.channel?.item || [];
        const itemList = Array.isArray(items) ? items : [items];

        logEntries.push(`[News Sync] ${feed.name}: parsed ${itemList.length} articles.`);

        for (const item of itemList.slice(0, 25)) {
          const title = item.title ? (typeof item.title === 'string' ? item.title : item.title._ || '') : '';
          const url = item.link || (item.guid && typeof item.guid === 'string' ? item.guid : item.guid?._ || '');
          if (!title || !url) continue;

          const rawSummary = item.description || item['content:encoded'] || '';
          const summary = typeof rawSummary === 'string' 
            ? rawSummary.replace(/<[^>]+>/g, '').slice(0, 280) + '...'
            : '';

          const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
          const validDate = isNaN(pubDate.getTime()) ? new Date() : pubDate;

          // Detect tagged state
          let taggedState = null;
          const searchContent = `${title} ${summary}`.toLowerCase();
          for (const [st, terms] of Object.entries(stateKeywords)) {
            if (terms.some(t => searchContent.includes(t))) {
              taggedState = st;
              break;
            }
          }

          // Detect tagged chamber
          let taggedChamber = null;
          if (searchContent.includes('senate') || searchContent.includes('senator')) {
            taggedChamber = 'senate';
          } else if (searchContent.includes('house') || searchContent.includes('congressional district')) {
            taggedChamber = 'house';
          }

          const id = crypto.createHash('md5').update(url).digest('hex');

          // Upsert article
          await execute(`
            INSERT INTO news_articles (id, title, url, source_name, published_at, summary, tagged_state, tagged_chamber)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
              tagged_state = COALESCE(VALUES(tagged_state), tagged_state),
              tagged_chamber = COALESCE(VALUES(tagged_chamber), tagged_chamber);
          `, [
            id,
            title,
            url,
            feed.name,
            validDate.toISOString().slice(0, 19).replace('T', ' '),
            summary,
            taggedState,
            taggedChamber
          ]);

          recordsAdded++;
        }
      } catch (feedErr) {
        logEntries.push(`[News Sync Feed Error] ${feed.name}: ${feedErr.message}`);
      }
    }

    logEntries.push(`[News Sync Complete] Ingested and reconciled ${recordsAdded} live election articles.`);
    return { success: true, recordsAdded, logs: logEntries.join('\n') };

  } catch (err) {
    logEntries.push(`[News Sync Error] ${err.message}`);
    return { success: false, recordsAdded, logs: logEntries.join('\n'), error: err.message };
  }
}
