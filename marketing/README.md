# WortheyFlow Marketing Tools

Automated Google Ads and Meta Ads reporting, rules engine, and competitor analysis for Worthey Aquatics, OverAssessed, and ProfitBlueprintCo.

## Setup

### 1. Install Dependencies

```bash
cd /Users/aquabot/Documents/WortheyFlow/marketing
pip install -r requirements.txt
```

### 2. Configure Google Ads API

Create `google-ads-config.yaml` in this directory:

```yaml
client_id: "YOUR_OAUTH_CLIENT_ID"
client_secret: "YOUR_OAUTH_CLIENT_SECRET"
developer_token: "YOUR_DEVELOPER_TOKEN"
login_customer_id: "1499758605"  # MCC account, no dashes
refresh_token: ""  # Will be filled by setup script
```

### 3. Generate OAuth Refresh Token

```bash
python google-ads-setup.py
```

This opens a browser for Google sign-in and saves the refresh token to your config.

### 4. Configure Meta Ads Token

Set the `META_ACCESS_TOKEN` environment variable, or ensure `.meta-tokens.json` exists with:

```json
{
  "user_access_token": "YOUR_LONG_LIVED_TOKEN"
}
```

---

## Usage

### Google Ads Campaign Report

```bash
# Worthey Aquatics — last 30 days
python google-ads-report.py --customer-id 1322494799 --days 30

# OverAssessed — last 7 days
python google-ads-report.py --customer-id 3513438695 --days 7

# Custom output path
python google-ads-report.py --customer-id 1322494799 --output reports/wa_weekly.json
```

### Google Ads Rules Engine

```bash
# Dry run for one company (preview only)
python google-ads-rules.py --company worthey-aquatics

# Dry run for all companies
python google-ads-rules.py --all

# Execute changes (will prompt for confirmation)
python google-ads-rules.py --company worthey-aquatics --execute
python google-ads-rules.py --all --execute
```

**Rules:**
1. **Pause high-CPL keywords** — Keywords with CPL > 1.5× target get paused
2. **Pause low-CTR ads** — Ads with CTR < 1% (100+ impressions) get paused
3. **Scale budgets up** — Campaigns with CPL < 80% of target get +20% budget
4. **Scale budgets down** — Campaigns with CPL > 130% of target get -20% budget

All actions are logged to `rules-log.json`.

### Google Ads Competitor Analysis

```bash
# Auction insights for Worthey Aquatics
python google-ads-competitors.py --customer-id 1322494799

# Last 7 days, JSON output
python google-ads-competitors.py --customer-id 1322494799 --days 7 --json

# Filter to specific campaign
python google-ads-competitors.py --customer-id 1322494799 --campaign-id 12345678
```

### Meta Ads Report

```bash
# Campaign-level report
python meta-ads-report.py --account-id YOUR_AD_ACCOUNT_ID --days 30

# Ad set level
python meta-ads-report.py --account-id YOUR_AD_ACCOUNT_ID --level adset

# Ad level with custom output
python meta-ads-report.py --account-id YOUR_AD_ACCOUNT_ID --level ad --output reports/meta_weekly.json
```

---

## Configuration

### marketing-config.json

Central configuration for all companies:
- Google Ads customer IDs
- CPL targets per campaign type
- Daily budget limits
- Rules engine thresholds

### Rules Thresholds

Edit `marketing-config.json` → `rules` section:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `high_cpl_threshold_multiplier` | 1.5 | Pause keywords with CPL > target × this |
| `low_ctr_threshold` | 0.01 | Pause ads with CTR below this (1%) |
| `budget_scale_up_factor` | 1.2 | Increase budget by 20% for good performers |
| `budget_scale_down_factor` | 0.8 | Decrease budget by 20% for poor performers |
| `min_impressions_for_rules` | 100 | Min impressions before CTR rule applies |
| `min_clicks_for_cpl` | 5 | Min clicks before CPL rules apply |

---

## File Structure

```
marketing/
├── README.md                    # This file
├── marketing-config.json        # Central config (companies, CPL targets, budgets)
├── requirements.txt             # Python dependencies
├── rules-log.json               # Rules engine action log
├── google-ads-config.yaml       # Google Ads API credentials (create manually)
├── google-ads-setup.py          # OAuth token generator
├── google-ads-report.py         # Campaign performance reporting
├── google-ads-rules.py          # Automated rules engine
├── google-ads-competitors.py    # Auction insights / competitor analysis
├── meta-ads-report.py           # Meta Ads reporting
└── reports/                     # Generated JSON reports
    └── .gitkeep
```

## Company IDs

| Company | Google Ads ID | Daily Budget |
|---------|--------------|-------------|
| Worthey Aquatics | 132-249-4799 | $50 |
| OverAssessed | 351-343-8695 | $50 |
| ProfitBlueprintCo | N/A (not yet) | $10 |

## CPL Targets

| Company | Category | Target CPL |
|---------|----------|-----------|
| Worthey Aquatics | Construction | $100 |
| Worthey Aquatics | Service | $30 |
| Worthey Aquatics | Equipment | $50 |
| OverAssessed | Default | $25 |
| ProfitBlueprintCo | Default | $5 |
