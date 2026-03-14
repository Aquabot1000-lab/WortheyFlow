# WortheyFlow Automation Server

Notification & automation backend for WortheyFlow CRM. Handles SMS (Twilio), email (SendGrid), and automation rules that fire on lead events.

## Setup

```bash
cd server
cp .env.example .env    # Edit with your API keys
npm install
npm start               # Runs on port 3001
npm run dev             # Dev mode with auto-reload
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number |
| `SENDGRID_API_KEY` | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | Sender email address |
| `JWT_SECRET` | Secret for JWT token signing |
| `GHL_WEBHOOK_SECRET` | Secret for GoHighLevel webhook verification |

Without Twilio/SendGrid keys, notifications run in **DRY RUN mode** (logged to console).

## API Endpoints

### Public (no auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Login, returns JWT token |
| `POST` | `/api/webhook/ghl?secret=...` | GoHighLevel webhook (creates leads) |

### Protected (JWT required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/automations` | List automation rules |
| `POST` | `/api/automations` | Create/update a rule |
| `DELETE` | `/api/automations/:id` | Delete a rule |
| `POST` | `/api/notify` | Send SMS or email directly |
| `POST` | `/api/automations/trigger` | Trigger automation evaluation |
| `POST` | `/api/automations/check-durations` | Check duration-based triggers |
| `GET` | `/api/contacts` | List salesperson contact directory |
| `PUT` | `/api/contacts` | Update contact directory |
| `GET` | `/api/logs` | View notification log |
| `GET` | `/api/users` | List users (admin only) |
| `POST` | `/api/users` | Create user (admin only) |
| `POST` | `/api/auth/change-password` | Change password |

### Mission Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/mc/overview` | Business overview data |
| `GET/POST` | `/api/mc/agents` | Agent status tracking |
| `GET/POST` | `/api/mc/revenue` | Revenue tracking |

## Automation Engine

Rules support 5 trigger types:
- **lead_created** — fires when a new lead is added
- **stage_change** — fires when a lead moves between stages
- **stage_enter** — fires when a lead enters a specific stage
- **stage_duration** — fires when a lead stays in a stage too long
- **manual_flag** — fires on manual trigger

Each rule has **conditions** (filter by jobType, salesperson, quoteAmount, source) and **actions** (SMS or email with template variables).

### Template Variables
`{{lead.name}}`, `{{lead.stage}}`, `{{lead.quoteAmount}}`, `{{lead.salesperson}}`, `{{lead.jobType}}`, `{{lead.phone}}`, `{{lead.email}}`, `{{lead.nextAction}}`, `{{lead.source}}`, `{{lead.lossReason}}`, `{{lead.salesperson_phone}}`, `{{lead.salesperson_email}}`, `{{lead.createdAgo}}`

### Default Rules
1. New Lead Assigned → SMS to salesperson
2. Lead Untouched >10min → SMS to Tyler
3. Lead Untouched >1hr → SMS escalation to Tyler
4. Stage Change → email to salesperson
5. Stalled Deal >14 days → email to Tyler
6. Deal Signed → celebration email to Tyler
7. Deal Lost → alert email to Tyler

## Deployment (Railway)

1. Push the `server/` directory to a Git repo
2. Connect to Railway
3. Set environment variables in Railway dashboard
4. Railway auto-detects the Procfile and starts the server

The frontend is static HTML — host on Surge, Vercel, Netlify, or any static host.

## Salesperson Directory

| Name | Phone | Email | Role |
|------|-------|-------|------|
| Anibal Lopez | 210-563-6099 | anibal@wortheyaquatics.com | Pool Construction |
| Ricardo Jaurez | 512-450-4426 | Ricardo@wortheyaquatics.com | Pool Construction |
| Richard Castille | 210-250-1416 | Richardc@wortheyaquatics.com | Service/Equipment |
| Tyler Worthey | 210-559-8725 | tyler@wortheyaquatics.com | Owner |
