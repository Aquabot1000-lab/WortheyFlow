#!/usr/bin/env python3
"""
Meta (Facebook/Instagram) Ads Performance Report
Pulls campaign insights via Graph API v19.0.
Calculates CPL from lead actions, outputs JSON + text summary.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MARKETING_CONFIG = os.path.join(SCRIPT_DIR, "marketing-config.json")
REPORTS_DIR = os.path.join(SCRIPT_DIR, "reports")

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"

INSIGHT_FIELDS = [
    "campaign_name",
    "campaign_id",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "actions",
    "cost_per_action_type",
]


def load_marketing_config():
    """Load marketing-config.json."""
    if os.path.exists(MARKETING_CONFIG):
        with open(MARKETING_CONFIG, "r") as f:
            return json.load(f)
    return None


def get_access_token():
    """Get Meta access token from environment or .meta-tokens.json."""
    token = os.environ.get("META_ACCESS_TOKEN")
    if token:
        return token

    # Try loading from the OverAssessed server tokens file
    token_files = [
        os.path.join(SCRIPT_DIR, ".meta-tokens.json"),
        os.path.expanduser("~/Documents/OverAssessed/server/.meta-tokens.json"),
    ]

    for path in token_files:
        if os.path.exists(path):
            with open(path, "r") as f:
                tokens = json.load(f)
                token = tokens.get("user_access_token") or tokens.get("long_lived_token")
                if token:
                    return token

    print("ERROR: No Meta access token found.")
    print("Set META_ACCESS_TOKEN env var or ensure .meta-tokens.json exists.")
    sys.exit(1)


def fetch_campaign_insights(ad_account_id, access_token, days, level="campaign"):
    """Fetch campaign insights from Meta Graph API."""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    url = f"{GRAPH_API_BASE}/act_{ad_account_id}/insights"
    params = {
        "access_token": access_token,
        "fields": ",".join(INSIGHT_FIELDS),
        "time_range": json.dumps({"since": start_date, "until": end_date}),
        "level": level,
        "limit": 100,
    }

    all_data = []
    while url:
        response = requests.get(url, params=params)

        if response.status_code != 200:
            error = response.json().get("error", {})
            print(f"ERROR ({response.status_code}): {error.get('message', 'Unknown error')}")
            print(f"  Type: {error.get('type', 'N/A')} | Code: {error.get('code', 'N/A')}")
            sys.exit(1)

        data = response.json()
        all_data.extend(data.get("data", []))

        # Handle pagination
        paging = data.get("paging", {})
        url = paging.get("next")
        params = {}  # Next URL includes all params

    return all_data, start_date, end_date


def parse_lead_actions(actions):
    """Extract lead-related actions from the actions list."""
    if not actions:
        return 0
    lead_types = [
        "lead",
        "onsite_conversion.lead_grouped",
        "offsite_conversion.fb_pixel_lead",
        "onsite_conversion.messaging_first_reply",
        "onsite_conversion.messaging_conversation_started_7d",
    ]
    total = 0
    for action in actions:
        if action.get("action_type") in lead_types:
            total += int(action.get("value", 0))
    return total


def parse_cost_per_lead(cost_per_action_type):
    """Extract cost per lead from cost_per_action_type."""
    if not cost_per_action_type:
        return None
    lead_types = [
        "lead",
        "onsite_conversion.lead_grouped",
        "offsite_conversion.fb_pixel_lead",
    ]
    for item in cost_per_action_type:
        if item.get("action_type") in lead_types:
            return float(item.get("value", 0))
    return None


def process_insights(raw_data):
    """Process raw API data into clean campaign records."""
    campaigns = []
    for row in raw_data:
        spend = float(row.get("spend", 0))
        impressions = int(row.get("impressions", 0))
        clicks = int(row.get("clicks", 0))
        ctr = float(row.get("ctr", 0))

        leads = parse_lead_actions(row.get("actions"))
        cpl_api = parse_cost_per_lead(row.get("cost_per_action_type"))
        cpl_calc = spend / leads if leads > 0 else None
        cpl = cpl_api or cpl_calc

        campaigns.append({
            "campaign_id": row.get("campaign_id"),
            "campaign_name": row.get("campaign_name"),
            "spend": round(spend, 2),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": round(ctr, 2),
            "leads": leads,
            "cpl": round(cpl, 2) if cpl else None,
            "all_actions": row.get("actions"),
        })

    return campaigns


def format_text_report(campaigns, ad_account_id, start_date, end_date):
    """Generate human-readable text summary."""
    lines = []
    lines.append("=" * 70)
    lines.append(f"  Meta Ads Report")
    lines.append(f"  Ad Account: {ad_account_id}")
    lines.append(f"  Period: {start_date} to {end_date}")
    lines.append("=" * 70)
    lines.append("")

    total_spend = 0
    total_clicks = 0
    total_impressions = 0
    total_leads = 0

    for c in campaigns:
        cpl_str = f"${c['cpl']:.2f}" if c["cpl"] else "N/A"
        lines.append(f"  📊 {c['campaign_name']}")
        lines.append(f"     Spend: ${c['spend']:.2f}  |  Impressions: {c['impressions']:,}  |  Clicks: {c['clicks']:,}")
        lines.append(f"     CTR: {c['ctr']}%  |  Leads: {c['leads']}  |  CPL: {cpl_str}")
        lines.append("")

        total_spend += c["spend"]
        total_clicks += c["clicks"]
        total_impressions += c["impressions"]
        total_leads += c["leads"]

    total_cpl = total_spend / total_leads if total_leads > 0 else None

    lines.append("-" * 70)
    lines.append(f"  TOTALS")
    lines.append(f"     Spend: ${total_spend:.2f}  |  Impressions: {total_impressions:,}  |  Clicks: {total_clicks:,}")
    lines.append(f"     Leads: {total_leads}  |  Overall CPL: {'$' + f'{total_cpl:.2f}' if total_cpl else 'N/A'}")
    lines.append("=" * 70)

    if not campaigns:
        lines.append("  No campaign data found for this period.")

    return "\n".join(lines)


def save_report(report_data, text_report, ad_account_id, output_path=None):
    """Save JSON report and print text summary."""
    os.makedirs(REPORTS_DIR, exist_ok=True)

    if output_path:
        json_path = output_path
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_path = os.path.join(REPORTS_DIR, f"meta_ads_{ad_account_id}_{timestamp}.json")

    # Strip all_actions from JSON output to keep it clean
    clean_campaigns = []
    for c in report_data["campaigns"]:
        clean = {k: v for k, v in c.items() if k != "all_actions"}
        clean_campaigns.append(clean)
    report_data["campaigns"] = clean_campaigns

    with open(json_path, "w") as f:
        json.dump(report_data, f, indent=2)

    print(text_report)
    print(f"\n  📁 JSON report saved: {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Meta Ads Campaign Performance Report")
    parser.add_argument("--account-id", required=True, help="Meta Ad Account ID (numbers only, without act_ prefix)")
    parser.add_argument("--days", type=int, default=30, help="Number of days to report on (default: 30)")
    parser.add_argument("--output", help="Custom output path for JSON report")
    parser.add_argument("--level", default="campaign", choices=["campaign", "adset", "ad"], help="Reporting level")
    args = parser.parse_args()

    access_token = get_access_token()

    print(f"Fetching Meta Ads data for last {args.days} days...")
    raw_data, start_date, end_date = fetch_campaign_insights(
        args.account_id, access_token, args.days, args.level
    )

    campaigns = process_insights(raw_data)

    report_data = {
        "ad_account_id": args.account_id,
        "period": {"start": start_date, "end": end_date, "days": args.days},
        "generated_at": datetime.now().isoformat(),
        "level": args.level,
        "campaigns": campaigns,
    }

    text_report = format_text_report(campaigns, args.account_id, start_date, end_date)
    save_report(report_data, text_report, args.account_id, args.output)


if __name__ == "__main__":
    main()
