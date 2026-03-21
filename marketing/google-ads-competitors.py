#!/usr/bin/env python3
"""
Google Ads Auction Insights / Competitor Analysis
Shows competitor domains, impression share, and overlap rate.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

import yaml
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

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
    """Load marketing-config.json."""
    if not os.path.exists(MARKETING_CONFIG):
        return None
    with open(MARKETING_CONFIG, "r") as f:
        return json.load(f)


def get_company_name(marketing_config, customer_id):
    """Look up company name by customer ID."""
    if not marketing_config:
        return f"Account {customer_id}"
    clean_id = customer_id.replace("-", "")
    for key, company in marketing_config.get("companies", {}).items():
        if company.get("google_ads_id") == clean_id:
            return company.get("name", key)
    return f"Account {customer_id}"


def run_auction_insights(client, customer_id, days, campaign_id=None):
    """Pull auction insights data via GAQL."""
    ga_service = client.get_service("GoogleAdsService")

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = f"""
        SELECT
            auction_insight.display_domain,
            metrics.auction_insight_search_impression_share,
            metrics.auction_insight_search_overlap_rate,
            metrics.auction_insight_search_position_above_rate,
            metrics.auction_insight_search_top_impression_percentage,
            metrics.auction_insight_search_absolute_top_impression_percentage,
            metrics.auction_insight_search_outranking_share
        FROM auction_insight
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
    """

    if campaign_id:
        query += f"    AND campaign.id = {campaign_id}\n"

    query += "ORDER BY metrics.auction_insight_search_impression_share DESC"

    clean_id = customer_id.replace("-", "")

    try:
        response = ga_service.search(customer_id=clean_id, query=query)
    except GoogleAdsException as e:
        print(f"ERROR: {e.failure.errors[0].message}")
        sys.exit(1)

    competitors = []
    for row in response:
        insight = row.auction_insight
        metrics = row.metrics

        competitors.append({
            "domain": insight.display_domain,
            "impression_share": round(metrics.auction_insight_search_impression_share * 100, 2),
            "overlap_rate": round(metrics.auction_insight_search_overlap_rate * 100, 2),
            "position_above_rate": round(metrics.auction_insight_search_position_above_rate * 100, 2),
            "top_impression_pct": round(metrics.auction_insight_search_top_impression_percentage * 100, 2),
            "abs_top_impression_pct": round(metrics.auction_insight_search_absolute_top_impression_percentage * 100, 2),
            "outranking_share": round(metrics.auction_insight_search_outranking_share * 100, 2),
        })

    return competitors, start_date, end_date


def format_report(competitors, customer_id, company_name, start_date, end_date):
    """Format competitors into a readable table."""
    lines = []
    lines.append("=" * 90)
    lines.append(f"  Auction Insights — {company_name}")
    lines.append(f"  Account: {customer_id}")
    lines.append(f"  Period: {start_date} to {end_date}")
    lines.append("=" * 90)
    lines.append("")

    # Header
    header = f"  {'Domain':<35} {'Impr Share':>10} {'Overlap':>8} {'Pos Above':>10} {'Top %':>7} {'Outrank':>8}"
    lines.append(header)
    lines.append("  " + "-" * 86)

    you = None
    others = []
    for c in competitors:
        if c["domain"] == "" or "you" in c["domain"].lower():
            you = c
            c["domain"] = "⭐ YOU"
        others.append(c)

    for c in others:
        line = (
            f"  {c['domain']:<35} "
            f"{c['impression_share']:>9.1f}% "
            f"{c['overlap_rate']:>7.1f}% "
            f"{c['position_above_rate']:>9.1f}% "
            f"{c['top_impression_pct']:>6.1f}% "
            f"{c['outranking_share']:>7.1f}%"
        )
        lines.append(line)

    lines.append("")
    lines.append("=" * 90)

    if not competitors:
        lines.append("  No auction insight data available for this period.")
        lines.append("  (Campaigns may need more impressions or search activity)")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Google Ads Auction Insights / Competitor Analysis")
    parser.add_argument("--customer-id", required=True, help="Google Ads customer ID")
    parser.add_argument("--days", type=int, default=30, help="Lookback period in days (default: 30)")
    parser.add_argument("--campaign-id", help="Filter to specific campaign ID")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    client = load_google_ads_client()
    marketing_config = load_marketing_config()
    company_name = get_company_name(marketing_config, args.customer_id)

    print(f"Fetching auction insights for last {args.days} days...")
    competitors, start_date, end_date = run_auction_insights(
        client, args.customer_id, args.days, args.campaign_id
    )

    if args.json:
        output = {
            "customer_id": args.customer_id,
            "company": company_name,
            "period": {"start": start_date, "end": end_date},
            "generated_at": datetime.now().isoformat(),
            "competitors": competitors,
        }
        # Save to reports/
        os.makedirs(REPORTS_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        clean_id = args.customer_id.replace("-", "")
        path = os.path.join(REPORTS_DIR, f"competitors_{clean_id}_{timestamp}.json")
        with open(path, "w") as f:
            json.dump(output, f, indent=2)
        print(json.dumps(output, indent=2))
        print(f"\n  📁 Saved: {path}")
    else:
        report = format_report(competitors, args.customer_id, company_name, start_date, end_date)
        print(report)


if __name__ == "__main__":
    main()
