#!/usr/bin/env python3
"""
Google Ads Campaign Performance Report
Pulls campaign metrics via GAQL, calculates CPL, outputs JSON + text summary.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

import yaml
from google.ads.googleads.client import GoogleAdsClient

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "google-ads-config.yaml")
MARKETING_CONFIG = os.path.join(SCRIPT_DIR, "marketing-config.json")
REPORTS_DIR = os.path.join(SCRIPT_DIR, "reports")


def load_google_ads_client():
    """Initialize GoogleAdsClient from YAML config."""
    if not os.path.exists(CONFIG_FILE):
        print(f"ERROR: {CONFIG_FILE} not found. Run google-ads-setup.py first.")
        sys.exit(1)
    return GoogleAdsClient.load_from_storage(CONFIG_FILE, version="v16")


def load_marketing_config():
    """Load marketing-config.json for CPL targets."""
    if not os.path.exists(MARKETING_CONFIG):
        print(f"WARNING: {MARKETING_CONFIG} not found. CPL targets unavailable.")
        return None
    with open(MARKETING_CONFIG, "r") as f:
        return json.load(f)


def get_company_for_customer_id(marketing_config, customer_id):
    """Find company config by Google Ads customer ID."""
    if not marketing_config:
        return None, None
    clean_id = customer_id.replace("-", "")
    for key, company in marketing_config.get("companies", {}).items():
        if company.get("google_ads_id") == clean_id:
            return key, company
    return None, None


def get_cpl_target(company_config, campaign_name=""):
    """Get CPL target based on campaign name keywords."""
    if not company_config:
        return None
    targets = company_config.get("cpl_targets", {})
    name_lower = campaign_name.lower()
    for category, target in targets.items():
        if category != "default" and category in name_lower:
            return target
    return targets.get("default")


def run_report(client, customer_id, days):
    """Execute GAQL query and return campaign performance data."""
    ga_service = client.get_service("GoogleAdsService")

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = f"""
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            metrics.impressions,
            metrics.clicks,
            metrics.ctr,
            metrics.conversions,
            metrics.cost_micros
        FROM campaign
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
    """

    clean_id = customer_id.replace("-", "")
    response = ga_service.search(customer_id=clean_id, query=query)

    campaigns = []
    for row in response:
        campaign = row.campaign
        metrics = row.metrics

        cost = metrics.cost_micros / 1_000_000
        conversions = metrics.conversions
        cpl = cost / conversions if conversions > 0 else None

        campaigns.append({
            "campaign_id": str(campaign.id),
            "campaign_name": campaign.name,
            "status": campaign.status.name,
            "impressions": metrics.impressions,
            "clicks": metrics.clicks,
            "ctr": round(metrics.ctr * 100, 2),
            "conversions": round(conversions, 2),
            "cost": round(cost, 2),
            "cpl": round(cpl, 2) if cpl else None,
        })

    return campaigns, start_date, end_date


def format_text_report(campaigns, customer_id, start_date, end_date, marketing_config):
    """Generate human-readable text summary."""
    company_key, company_config = get_company_for_customer_id(marketing_config, customer_id)
    company_name = company_config["name"] if company_config else f"Account {customer_id}"

    lines = []
    lines.append("=" * 70)
    lines.append(f"  Google Ads Report — {company_name}")
    lines.append(f"  Account: {customer_id}")
    lines.append(f"  Period: {start_date} to {end_date}")
    lines.append("=" * 70)
    lines.append("")

    total_cost = 0
    total_clicks = 0
    total_impressions = 0
    total_conversions = 0

    for c in campaigns:
        cpl_target = get_cpl_target(company_config, c["campaign_name"])
        cpl_status = ""
        if c["cpl"] is not None and cpl_target:
            if c["cpl"] > cpl_target:
                cpl_status = f" ⚠️  OVER TARGET (${cpl_target})"
            else:
                cpl_status = f" ✅ Under target (${cpl_target})"

        lines.append(f"  📊 {c['campaign_name']} [{c['status']}]")
        lines.append(f"     Impressions: {c['impressions']:,}  |  Clicks: {c['clicks']:,}  |  CTR: {c['ctr']}%")
        lines.append(f"     Conversions: {c['conversions']}  |  Cost: ${c['cost']:.2f}  |  CPL: {'$' + str(c['cpl']) if c['cpl'] else 'N/A'}{cpl_status}")
        lines.append("")

        total_cost += c["cost"]
        total_clicks += c["clicks"]
        total_impressions += c["impressions"]
        total_conversions += c["conversions"]

    total_cpl = total_cost / total_conversions if total_conversions > 0 else None

    lines.append("-" * 70)
    lines.append(f"  TOTALS")
    lines.append(f"     Impressions: {total_impressions:,}  |  Clicks: {total_clicks:,}")
    lines.append(f"     Conversions: {total_conversions:.1f}  |  Total Spend: ${total_cost:.2f}")
    lines.append(f"     Overall CPL: {'$' + f'{total_cpl:.2f}' if total_cpl else 'N/A'}")
    lines.append("=" * 70)

    return "\n".join(lines)


def save_report(data, text_report, customer_id, output_path=None):
    """Save JSON report and print text summary."""
    os.makedirs(REPORTS_DIR, exist_ok=True)

    if output_path:
        json_path = output_path
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_path = os.path.join(REPORTS_DIR, f"google_ads_{customer_id}_{timestamp}.json")

    with open(json_path, "w") as f:
        json.dump(data, f, indent=2)

    print(text_report)
    print(f"\n  📁 JSON report saved: {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Google Ads Campaign Performance Report")
    parser.add_argument("--customer-id", required=True, help="Google Ads customer ID (with or without dashes)")
    parser.add_argument("--days", type=int, default=30, help="Number of days to report on (default: 30)")
    parser.add_argument("--output", help="Custom output path for JSON report")
    args = parser.parse_args()

    client = load_google_ads_client()
    marketing_config = load_marketing_config()

    print(f"Fetching campaign data for last {args.days} days...")
    campaigns, start_date, end_date = run_report(client, args.customer_id, args.days)

    if not campaigns:
        print("No campaign data found for the specified period.")
        sys.exit(0)

    report_data = {
        "customer_id": args.customer_id,
        "period": {"start": start_date, "end": end_date, "days": args.days},
        "generated_at": datetime.now().isoformat(),
        "campaigns": campaigns,
    }

    text_report = format_text_report(campaigns, args.customer_id, start_date, end_date, marketing_config)
    save_report(report_data, text_report, args.customer_id.replace("-", ""), args.output)


if __name__ == "__main__":
    main()
