# WortheyFlow → Supabase Migration

## Overview
Migrated WortheyFlow CRM from localStorage/JSON files to Supabase PostgreSQL for improved reliability, scalability, and real-time sync.

## Completed Steps

### 1. Database Setup ✅
- Created `wortheyflow_leads` table in Supabase PostgreSQL
- Imported 234 existing leads from `leads-data.js`
- Table schema:
  - All lead fields (name, phone, email, etc.)
  - snake_case column names (e.g., `job_type`, `quote_amount`)
  - JSONB columns for `activities` and `ghl_raw`
  - Timestamps: `created_at`, `stage_changed_at`, `updated_at`

### 2. Server.js Updates ✅
- Added Supabase client initialization with env var fallbacks
- Created helper functions:
  - `leadToDbRow()`: Convert camelCase JS → snake_case DB
  - `dbRowToLead()`: Convert snake_case DB → camelCase JS
- Updated all endpoints to use Supabase instead of leads.json:
  - `POST /api/webhook/ghl`: Insert webhook leads to Supabase
  - `GET /api/leads`: Fetch all leads from Supabase
  - `GET /api/webhook-leads`: Fetch recent GHL leads
  - `PUT /api/leads/:id`: Update a lead
  - `DELETE /api/leads/:id`: Delete a lead
  - `POST /api/booth-lead`: Insert booth leads
  - `GET /api/bot/leads`: AquaBot API
  - `POST /api/sms/inbound`: Inbound SMS handler
- Updated automation system:
  - `recordDeliveryOnLead()`: Save to Supabase
  - `scheduleUntouchedAlert()`: Check Supabase
  - Server-side duration checks: Query Supabase every 5 min
- Kept all automation logic intact

### 3. Remaining Tasks

#### ⏳ Frontend (app.js)
- Replace `localStorage.getItem('wf_leads')` with API fetch
- On login: `GET /api/leads` → store in memory
- On lead change: `PUT /api/leads/:id` + update local array
- Remove `syncWebhookLeads()` function (all data from API)
- Add periodic refresh (every 60s) to fetch new leads
- Show toast notification for new leads

#### ⏳ Railway Deployment
```bash
railway variables --set SUPABASE_URL=https://ylxreuqvofgbpsatfsvr.supabase.co
railway variables --set SUPABASE_SERVICE_ROLE_KEY=<key>
git add -A
git commit -m "feat: migrate to Supabase PostgreSQL"
git push origin master
railway up
```

## Environment Variables
Add to Railway (and local `.env`):
```
SUPABASE_URL=https://ylxreuqvofgbpsatfsvr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Testing Checklist
- [ ] Webhook endpoint accepts new GHL leads
- [ ] GET /api/leads returns all 234+ leads
- [ ] PUT /api/leads/:id updates a lead
- [ ] DELETE /api/leads/:id deletes a lead
- [ ] Automations still fire on lead_created
- [ ] SMS alerts still send to salespeople
- [ ] Frontend loads leads from API
- [ ] Frontend updates leads via PUT
- [ ] Periodic refresh works (60s interval)

## Rollback Plan
If issues arise:
1. Revert `server/server.js` to previous version
2. Remove Supabase env vars
3. Re-deploy to Railway
4. Leads will resume using `leads.json`

## Notes
- Database contains 234 leads (imported from leads-data.js on 2026-03-23)
- All webhook leads (ID starts with `ghl-`) are synced
- Activities are stored as JSONB in DB
- No breaking changes to frontend API contract
- Automation logic unchanged

## Migration Scripts
- `server/create-table.js`: Create Supabase table via pg client
- `server/migrate-to-supabase.js`: Import leads from leads-data.js
- `server/create-table-sql.sql`: Manual SQL for table creation
