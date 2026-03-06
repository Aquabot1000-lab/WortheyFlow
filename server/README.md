# WortheyFlow Automation Server

Notification & automation backend for WortheyFlow CRM.

## Setup

```bash
cd server
cp .env.example .env    # Edit with your API keys
npm install
npm start               # Runs on port 3001
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

Without Twilio/SendGrid keys, notifications run in **DRY RUN mode** (logged to console).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/automations` | List automation rules |
| `POST` | `/api/automations` | Create/update a rule |
| `DELETE` | `/api/automations/:id` | Delete a rule |
| `POST` | `/api/notify` | Send a notification directly |
| `POST` | `/api/automations/trigger` | Trigger automation evaluation |
| `POST` | `/api/automations/check-durations` | Check duration-based triggers |
| `GET` | `/api/logs` | View notification log |

## Deployment

Deploy to Railway, Render, or Fly.io. Set environment variables in the hosting dashboard.
