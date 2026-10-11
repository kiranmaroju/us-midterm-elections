# US Midterm Elections Hub: Comprehensive Production Implementation Plan

## 1. System Architecture & High-Level Design

The platform consists of a **Node.js/Express Backend** with a **MySQL Database**, an automated **Ingestion & Job Scheduling Engine**, an **Admin Control Portal**, and a **Mobile-First Progressive Web App (PWA)** frontend.

```mermaid
graph TD
    subgraph Data Sources [100% Authentic Open & Free Sources]
        MM[Manifold Markets API<br/>Real-Time Win Odds]
        FEC[Open FEC Government API<br/>Official Candidates & Filings]
        CL[US Congress Civic Dataset<br/>Incumbent Rosters & Bioguides]
        WK[Wikipedia / Wikimedia REST<br/>Bios & Official Portraits]
        RSS[Politico / NPR / The Hill RSS<br/>Live Breaking Campaign News]
    end

    subgraph Backend Engine [Node.js + Express + Scheduler]
        SCHED[Job Scheduler Engine<br/>Realtime: 5m | Hourly: 1h | Daily: 24h]
        INGEST[Data Fetchers & Normalizers]
        AUDIT[Audit Logger & Health Monitor]
        API[REST API Layer & Auth Guard]
        SCHED --> INGEST
        INGEST --> AUDIT
    end

    subgraph Database [MySQL on VPS / Local Compatible]
        DB[(MySQL Database<br/>Races, Candidates, Odds, News, Config, Logs)]
    end

    subgraph Frontend [Mobile-First PWA + Admin]
        PWA[Public Mobile-First PWA<br/>Bottom Nav, Hex Map, Race Dossiers, Odds]
        ADMIN[Admin Portal<br/>Job Control, Audit Logs, Candidates, SEO, Config]
        AI[AI Crawlers & Search Engines<br/>GEO /llms.txt, JSON-LD, Sitemap]
    end

    Data Sources --> INGEST
    INGEST --> DB
    DB --> API
    API --> PWA
    API --> ADMIN
    API --> AI
```

---

## 2. Authentic Free & Open-Source Data Ingestion Pipelines

No data will ever be mocked or hardcoded. The ingestion engine connects directly to the following live sources:

### A. Real-Time Win Probabilities & Prediction Odds
* **Primary Source:** **Manifold Markets Public API**
  * **Endpoint:** `https://api.manifold.markets/v0/search-markets?term=2026%20Senate` (and chamber/state specific market queries).
  * **Authentication:** None (Public, unrestricted read).
  * **Data Ingested:** Exact probability (0.0 to 1.0), 24h volume, price history, question text, market resolution status.
  * **Frequency:** Real-time job (runs every 5 to 15 minutes, configurable).

### B. Official Candidates & Contestants
* **Primary Source:** **Federal Election Commission (FEC) Open Government API**
  * **Endpoint:** `https://api.open.fec.gov/v1/candidates/?election_year=2026&api_key=DEMO_KEY`
  * **Data Ingested:** Registered candidate name, FEC candidate ID, political party, office sought (Senate, House), state, district, incumbent status.
  * **Secondary Source:** **United States Project Congress Legislators (`unitedstates/congress-legislators`)**
  * **Endpoint:** `https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml`
  * **Data Ingested:** 535 current members of Congress, exact terms, official Bioguide ID, Wikipedia article title, official government websites, and party affiliation.
  * **Frequency:** Hourly incremental sync, daily deep reconciliation.

### C. Candidate Portraits & Biographies
* **Primary Source:** **Wikipedia & Wikimedia REST API**
  * **Endpoint:** `https://en.wikipedia.org/api/rest_v1/page/summary/[Wikipedia_Title]`
  * **Data Ingested:** Official high-resolution thumbnail URL (Wikimedia Commons), verified biographical summary snippet, official birthdate, and background.
  * **Frequency:** Daily job / on-demand when a new candidate enters the race.

### D. Real-Time Live Election News
* **Primary Sources:**
  * **Politico RSS:** `https://rss.politico.com/politics-news.xml`
  * **NPR Politics RSS:** `https://feeds.npr.org/1014/rss.xml`
  * **The Hill Politics RSS:** `https://thehill.com/feed/`
* **Data Ingested:** Article title, URL, publication timestamp, source name, author, excerpt, and auto-tagging by state/chamber (e.g., matching "Senate", "House", "Pennsylvania", "Georgia", etc.).
* **Frequency:** Real-time job (runs every 10 to 15 minutes).

---

## 3. MySQL Database Schema

The schema is built for production on MySQL (with zero foreign key locking bottlenecks, clean indexes for sub-millisecond queries, and full auditability).

```sql
-- 1. Races / Seats Table (Senate, House, Governor)
CREATE TABLE IF NOT EXISTS races (
    id VARCHAR(64) PRIMARY KEY, -- e.g., 'senate-pa', 'house-tx-21', 'gov-ga'
    chamber ENUM('senate', 'house', 'governor') NOT NULL,
    state_code VARCHAR(2) NOT NULL, -- e.g. 'PA', 'TX'
    district_num INT DEFAULT NULL, -- NULL for Senate/Governor, e.g. 21 for House
    title VARCHAR(255) NOT NULL,
    rating ENUM('solid_d', 'lean_d', 'tossup', 'lean_r', 'solid_r') DEFAULT 'tossup',
    is_battleground BOOLEAN DEFAULT FALSE,
    current_holder_party VARCHAR(32) DEFAULT NULL,
    dem_win_prob DECIMAL(5,2) DEFAULT NULL, -- Calculated / aggregate % (0.00 - 100.00)
    rep_win_prob DECIMAL(5,2) DEFAULT NULL,
    is_prob_overridden BOOLEAN DEFAULT FALSE,
    notes TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chamber_state (chamber, state_code),
    INDEX idx_battleground (is_battleground)
);

-- 2. Candidates Table
CREATE TABLE IF NOT EXISTS candidates (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'fec-S6PA00123' or 'bioguide-C000127'
    race_id VARCHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(128),
    last_name VARCHAR(128),
    party VARCHAR(64) NOT NULL, -- 'Democrat', 'Republican', 'Independent', etc.
    is_incumbent BOOLEAN DEFAULT FALSE,
    fec_id VARCHAR(32),
    bioguide_id VARCHAR(32),
    photo_url VARCHAR(512),
    bio_snippet TEXT,
    campaign_website VARCHAR(512),
    fec_total_receipts DECIMAL(14,2) DEFAULT 0.00,
    fec_cash_on_hand DECIMAL(14,2) DEFAULT 0.00,
    individual_win_prob DECIMAL(5,2) DEFAULT NULL,
    prob_override DECIMAL(5,2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE,
    INDEX idx_race (race_id),
    INDEX idx_party (party)
);

-- 3. Odds & Probability Snapshots (Historical Tracking for Charts)
CREATE TABLE IF NOT EXISTS odds_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    race_id VARCHAR(64) NOT NULL,
    source VARCHAR(64) NOT NULL, -- 'manifold', 'polymarket', 'aggregate'
    dem_prob DECIMAL(5,2),
    rep_prob DECIMAL(5,2),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_race_time (race_id, recorded_at)
);

-- 4. Live News Articles
CREATE TABLE IF NOT EXISTS news_articles (
    id VARCHAR(128) PRIMARY KEY, -- MD5 hash of link/guid
    title VARCHAR(512) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    source_name VARCHAR(64) NOT NULL, -- 'Politico', 'NPR', 'The Hill'
    published_at DATETIME NOT NULL,
    summary TEXT,
    tagged_state VARCHAR(2) DEFAULT NULL,
    tagged_chamber VARCHAR(32) DEFAULT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_published (published_at),
    INDEX idx_pinned (is_pinned, published_at)
);

-- 5. Automated Jobs Configuration
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(64) PRIMARY KEY, -- 'sync_odds', 'sync_news', 'sync_fec', 'sync_legislators'
    name VARCHAR(128) NOT NULL,
    description VARCHAR(255),
    schedule_interval_mins INT NOT NULL, -- e.g. 5, 15, 60, 1440
    status ENUM('IDLE', 'RUNNING', 'SUCCESS', 'FAILED') DEFAULT 'IDLE',
    last_run_at DATETIME DEFAULT NULL,
    next_run_at DATETIME DEFAULT NULL,
    last_duration_ms INT DEFAULT 0,
    last_status_message TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 6. Job Execution Audit Logs
CREATE TABLE IF NOT EXISTS job_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(64) NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    duration_ms INT,
    status ENUM('SUCCESS', 'FAILED') NOT NULL,
    records_added INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    log_output LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_job_logs (job_id, started_at)
);

-- 7. Site Settings & SEO Configuration (Single Source of Truth)
CREATE TABLE IF NOT EXISTS site_config (
    config_key VARCHAR(64) PRIMARY KEY,
    config_value LONGTEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## 4. Background Job Engine & Audit Log System

The scheduler operates within the Node.js process using a lightweight interval clock (resilient against crashes, automatically recalculating next run times).

### Job Definitions:
1. **`sync_odds` (Real-Time - Every 5 minutes)**:
   - Queries Manifold Markets for 2026 election contracts.
   - Computes probability changes, updates `races` and `candidates`, and writes to `odds_snapshots`.
   - Records audit log with number of markets inspected and probability shifts.
2. **`sync_news` (Real-Time - Every 10 minutes)**:
   - Fetches XML RSS from Politico, NPR, and The Hill concurrently.
   - De-duplicates by URL hash, applies regex state/candidate keyword tags, inserts fresh records into `news_articles`.
   - Records audit log with new article count.
3. **`sync_fec_candidates` (Hourly - Every 60 minutes)**:
   - Calls Open FEC candidate filings for 2026.
   - Updates campaign fundraising statistics and newly registered contenders.
4. **`sync_legislators_deep` (Daily - Every 24 hours)**:
   - Verifies all sitting Senate and House members against the GitHub Congress Legislators dataset.
   - Fetches updated official portraits from Wikimedia REST API.

### Admin Job Control:
- **Instant Trigger:** `POST /api/admin/jobs/:jobId/run` immediately starts the job in the background and streams logs.
- **Schedule Customizer:** `PATCH /api/admin/jobs/:jobId` allows changing interval (e.g. from 15m to 3m on election night).
- **Audit Log Inspection:** `GET /api/admin/jobs/logs` returns historical run details, execution times, and errors.

---

## 5. Comprehensive Admin Portal (`/admin`)

The Admin Portal is a protected, full-featured management studio:

1. **Dashboard & System Health Overview**:
   - Total tracked seats, total candidates, live news count, database connection health.
   - Visual status cards for all 4 background jobs with countdown timers to next execution.
2. **Job Management & Audit Logs Screen**:
   - Live table of jobs with toggle switches (`Enabled`/`Disabled`), interval editors, and a prominent **"Run Now"** button.
   - Filterable Audit Log Viewer showing execution duration, records updated, and full stack trace/diagnostic outputs.
3. **Candidate & Race Manager**:
   - Live table of all races with filter by Senate, House, and Governor.
   - Edit Candidate Modal:
     - Full Name, Party, Incumbent toggle.
     - Headshot Photo URL previewer and updater.
     - Campaign Website, Bio snippet.
     - **Probability Override Tool:** Set a manual probability lock or revert to live market consensus.
   - **"Add Custom Candidate / Special Election"** button for emergency ballot changes.
4. **Live News Moderation Screen**:
   - View auto-ingested articles in real-time.
   - Toggle **"Pin to Top"** for breaking race calls.
   - Toggle **"Hide"** for off-topic articles.
   - **"Publish Manual News Flash"** for breaking editorial alerts.
5. **SEO & Site Configuration Studio**:
   - **Traditional SEO**: Global Site Title, Meta Description, Primary & Long-tail Keywords, Canonical URL, OpenGraph Image URL, Twitter Handle.
   - **AI Search & GEO Configuration**:
     - `llms.txt` Generator preview and custom directives for AI search engines (Perplexity, ChatGPT, Claude).
     - Robots.txt rule editor (enabling/restricting specific AI bots).
     - JSON-LD Schema settings (Election Event, Candidate Person, FAQ blocks).
   - **Site Features**:
     - Election Countdown Date toggle.
     - Top Alert Banner text and color.
     - Theme default (Dark / Light).

---

## 6. Mobile-First PWA Public Experience

Designed with rich aesthetics, modern glassmorphism, dynamic micro-animations, and instant responsiveness:

1. **Mobile App Navigation**:
   - Sticky bottom tab bar: `[Dashboard]`, `[Senate]`, `[House]`, `[News]`, `[Search]`.
   - Top Header with Quick State Selector and Dark/Light mode switcher.
2. **National Pulse Dashboard**:
   - **Senate Balance of Power Bar**: Current breakdown (Dem vs Rep vs Toss-ups) with animated swing indicators.
   - **House 435 Breakdown**: Battle for the 218-seat majority.
   - **Interactive Hex Cartogram**: Touch-friendly hexagonal map of the United States.
   - **Top 5 Toss-up Showdowns**: High-stakes Senate & House races with live probability needles.
3. **Seat Detail Dossier (`/race/:id`)**:
   - Head-to-head candidate face-off cards with official portraits and party badges.
   - Dual Probability Meter: Live Prediction Market Odds vs Polling Average.
   - FEC Fundraising Comparison: Cash-on-hand visual bars.
   - Local Live News Feed: News specifically filtered for this state/race.
   - AI Fact Box & FAQ Accordion: Optimized for quick user reading and AI search tool citation.
4. **PWA Native Capabilities**:
   - `manifest.webmanifest` configured with responsive icons and theme color.
   - Service Worker (`sw.js`) utilizing Cache-First for static assets and Stale-While-Revalidate for candidate data so the app opens instantly even offline.

---

## 7. Dual SEO & GEO (AI Search Engine Optimization)

| Engine Category | Optimization Technique | Output & Implementation |
|---|---|---|
| **Traditional Search (Google, Bing)** | **Semantic HTML & Clean Routing** | Unique `<h1>`, descriptive title tags, state-by-state URLs (`/senate/pennsylvania`). |
| **Traditional Search** | **JSON-LD Schema Markup** | Rich snippets for `Election`, `Person` (Candidates), `NewsArticle`, and `FAQPage`. |
| **Traditional Search** | **Automated Sitemap & Robots** | Dynamically generated `/sitemap.xml` containing all state and candidate routes. |
| **AI Search (ChatGPT, Perplexity, Claude)** | **`llms.txt` & `llms-full.txt`** | Machine-readable Markdown summary at root with structured lists of races, probabilities, and candidate dossiers. |
| **AI Search** | **Direct Answer Extraction Boxes** | Front-loaded, high-density factual paragraphs at the top of each page designed for direct quote extraction. |
| **AI Search** | **Verifiable Source Attribution** | Polling & probability tables displaying data source, timestamp, and methodology. |

---

## 8. Database Portability: Local Development to VPS MySQL

To ensure smooth development and deployment:
- The system includes a **Database Connection Adapter** that supports:
  - **Local SQLite / MySQL** during development.
  - **Direct MySQL on your VPS** simply by setting environment variables in `.env`:
    ```env
    DB_TYPE=mysql
    DB_HOST=your-vps-ip-or-localhost
    DB_PORT=3306
    DB_USER=your_db_user
    DB_PASSWORD=your_db_password
    DB_NAME=us_midterm_db
    PORT=5000
    ```
- An automated migration script (`npm run db:init`) that automatically verifies connection, creates all 7 MySQL tables, and seeds initial configuration parameters.

---

## 9. Phased Execution Roadmap

- **Phase 1: Database Setup & Authentic Data Ingestion Engine**
  - Database schema & connection adapter (MySQL compatible).
  - Authentic API fetchers: Manifold Markets odds, Open FEC candidates, Congress legislators, Wikipedia portraits, and Politico/NPR RSS news.
  - Background scheduler engine with job tracking and audit logger.
- **Phase 2: Backend REST API & Admin Endpoints**
  - Public data endpoints for races, candidates, odds, news, search, and SEO.
  - Admin management endpoints for jobs, candidate editing, news moderation, and site configuration.
- **Phase 3: Admin Portal UI**
  - Responsive Admin Studio with Job Status & Audit Logs, Candidate/Race Editor, News Manager, and SEO/Config Editor.
- **Phase 4: Mobile-First PWA Web Application**
  - Mobile layout with bottom navigation, hex map, probability meters, candidate showdowns, and live news ticker.
  - Service worker and web manifest for offline PWA installation.
- **Phase 5: SEO, GEO (`llms.txt`) & Verification**
  - Dynamic JSON-LD structured data, `/llms.txt`, `/sitemap.xml`, and complete end-to-end verification.
