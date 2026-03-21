#!/usr/bin/env python3
"""
Google Ads Automated Rules Engine
Implements 4 rules:
  1. Pause high-CPL keywords
  2. Pause low-CTR ads
  3. Scale budgets up (good performance)
  4. Scale budgets down (poor performance)
All actions logged to rules-log.json.
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
RULES_LOG = os.path.join(SCRIPT_DIR, "rules-log.json")


def load_configs():
    """Load both google-ads-config.yaml and marketing-config.json."""
    if not os.path.exists(CONFIG_FILE):
        print(f"ERROR: {CONFIG_FILE} not found. Run google-ads-setup.py first.")
        sys.exit(1)
    if not os.path.exists(MARKETING_CONFIG):
        print(f"ERROR: {MARKETING_CONFIG} not found.")
        sys.exit(1)

    with open(MARKETING_CONFIG, "r") as f:
        marketing = json.load(f)

    client = GoogleAdsClient.load_from_storage(CONFIG_FILE, version="v16")
    return client, marketing


def load_rules_log():
    """Load existing rules log."""
    if os.path.exists(RULES_LOG):
        with open(RULES_LOG, "r") as f:
            return json.load(f)
    return []


def save_rules_log(log):
    """Save rules log."""
    with open(RULES_LOG, "w") as f:
        json.dump(log, f, indent=2)


def log_action(rules_log, company, rule, entity_type, entity_id, entity_name, action, details, executed):
    """Add an entry to the rules log."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "company": company,
        "rule": rule,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "entity_name": entity_name,
        "action": action,
        "details": details,
        "executed": executed,
    }
    rules_log.append(entry)
    status = "EXECUTED" if executed else "DRY RUN"
    print(f"  [{status}] {rule}: {action} — {entity_name} ({details})")
    return entry


def get_cpl_target(company_config, campaign_name=""):
    """Get CPL target for a campaign based on name keywords."""
    targets = company_config.get("cpl_targets", {})
    name_lower = campaign_name.lower()
    for category, target in targets.items():
        if category != "default" and category in name_lower:
            return target
    return targets.get("default", 50)


# ─── Rule 1: Pause High-CPL Keywords ────────────────────────────────────────

def rule_pause_high_cpl_keywords(client, customer_id, company_key, company_config, rules_config, rules_log, execute):
    """Pause keywords with CPL exceeding threshold × target."""
    print(f"\n  🔍 Rule 1: Pause High-CPL Keywords")
    ga_service = client.get_service("GoogleAdsService")
    threshold_mult = rules_config.get("high_cpl_threshold_multiplier", 1.5)
    min_clicks = rules_config.get("min_clicks_for_cpl", 5)

    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    query = f"""
        SELECT
            campaign.name,
            ad_group.name,
            ad_group_criterion.keyword.text,
            ad_group_criterion.resource_name,
            ad_group_criterion.status,
            metrics.clicks,
            metrics.conversions,
            metrics.cost_micros
        FROM keyword_view
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            AND ad_group_criterion.status = 'ENABLED'
            AND metrics.clicks >= {min_clicks}
        ORDER BY metrics.cost_micros DESC
    """

    try:
        response = ga_service.search(customer_id=customer_id, query=query)
    except GoogleAdsException as e:
        print(f"    ⚠️  API error: {e.failure.errors[0].message}")
        return

    actions_taken = 0
    for row in response:
        cost = row.metrics.cost_micros / 1_000_000
        conversions = row.metrics.conversions
        keyword_text = row.ad_group_criterion.keyword.text
        campaign_name = row.campaign.name

        if conversions == 0 and cost > 0:
            cpl = float("inf")
        elif conversions > 0:
            cpl = cost / conversions
        else:
            continue

        cpl_target = get_cpl_target(company_config, campaign_name)
        max_cpl = cpl_target * threshold_mult

        if cpl > max_cpl:
            resource_name = row.ad_group_criterion.resource_name
            detail = f"CPL=${cpl:.2f} > max=${max_cpl:.2f} (target=${cpl_target}, clicks={row.metrics.clicks})"

            if execute:
                try:
                    criterion_service = client.get_service("AdGroupCriterionService")
                    operation = client.get_type("AdGroupCriterionOperation")
                    criterion = operation.update
                    criterion.resource_name = resource_name
                    criterion.status = client.enums.AdGroupCriterionStatusEnum.PAUSED
                    client.copy_from(operation.update_mask, client.get_type("FieldMask")(paths=["status"]))
                    criterion_service.mutate_ad_group_criteria(customer_id=customer_id, operations=[operation])
                    log_action(rules_log, company_key, "pause_high_cpl_keyword", "keyword", resource_name, keyword_text, "PAUSED", detail, True)
                except GoogleAdsException as e:
                    print(f"    ❌ Failed to pause '{keyword_text}': {e.failure.errors[0].message}")
            else:
                log_action(rules_log, company_key, "pause_high_cpl_keyword", "keyword", resource_name, keyword_text, "WOULD_PAUSE", detail, False)

            actions_taken += 1

    if actions_taken == 0:
        print("    ✅ No high-CPL keywords found")


# ─── Rule 2: Pause Low-CTR Ads ──────────────────────────────────────────────

def rule_pause_low_ctr_ads(client, customer_id, company_key, company_config, rules_config, rules_log, execute):
    """Pause ads with CTR below threshold."""
    print(f"\n  🔍 Rule 2: Pause Low-CTR Ads")
    ga_service = client.get_service("GoogleAdsService")
    min_impressions = rules_config.get("min_impressions_for_rules", 100)
    low_ctr = rules_config.get("low_ctr_threshold", 0.01)

    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    query = f"""
        SELECT
            campaign.name,
            ad_group.name,
            ad_group_ad.ad.id,
            ad_group_ad.ad.name,
            ad_group_ad.resource_name,
            ad_group_ad.status,
            metrics.impressions,
            metrics.clicks,
            metrics.ctr
        FROM ad_group_ad
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            AND ad_group_ad.status = 'ENABLED'
            AND metrics.impressions >= {min_impressions}
        ORDER BY metrics.ctr ASC
    """

    try:
        response = ga_service.search(customer_id=customer_id, query=query)
    except GoogleAdsException as e:
        print(f"    ⚠️  API error: {e.failure.errors[0].message}")
        return

    actions_taken = 0
    for row in response:
        ctr = row.metrics.ctr
        if ctr < low_ctr:
            resource_name = row.ad_group_ad.resource_name
            ad_id = row.ad_group_ad.ad.id
            ad_name = row.ad_group_ad.ad.name or f"Ad {ad_id}"
            detail = f"CTR={ctr*100:.3f}% < {low_ctr*100:.1f}% (impressions={row.metrics.impressions}, clicks={row.metrics.clicks})"

            if execute:
                try:
                    ad_service = client.get_service("AdGroupAdService")
                    operation = client.get_type("AdGroupAdOperation")
                    ad = operation.update
                    ad.resource_name = resource_name
                    ad.status = client.enums.AdGroupAdStatusEnum.PAUSED
                    client.copy_from(operation.update_mask, client.get_type("FieldMask")(paths=["status"]))
                    ad_service.mutate_ad_group_ads(customer_id=customer_id, operations=[operation])
                    log_action(rules_log, company_key, "pause_low_ctr_ad", "ad", ad_id, ad_name, "PAUSED", detail, True)
                except GoogleAdsException as e:
                    print(f"    ❌ Failed to pause ad {ad_id}: {e.failure.errors[0].message}")
            else:
                log_action(rules_log, company_key, "pause_low_ctr_ad", "ad", ad_id, ad_name, "WOULD_PAUSE", detail, False)

            actions_taken += 1

    if actions_taken == 0:
        print("    ✅ No low-CTR ads found")


# ─── Rule 3 & 4: Scale Budgets Up/Down ──────────────────────────────────────

def rule_scale_budgets(client, customer_id, company_key, company_config, rules_config, rules_log, execute):
    """Scale campaign budgets up for good performers, down for poor ones."""
    print(f"\n  🔍 Rule 3/4: Scale Budgets Up/Down")
    ga_service = client.get_service("GoogleAdsService")
    scale_up = rules_config.get("budget_scale_up_factor", 1.2)
    scale_down = rules_config.get("budget_scale_down_factor", 0.8)
    min_clicks = rules_config.get("min_clicks_for_cpl", 5)
    daily_budget_limit = company_config.get("daily_budget", 50) * 1_000_000  # micros

    start_date = (datetime.now() - timedelta(days=14)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    query = f"""
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.campaign_budget,
            campaign_budget.amount_micros,
            campaign_budget.resource_name,
            metrics.clicks,
            metrics.conversions,
            metrics.cost_micros
        FROM campaign
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            AND campaign.status = 'ENABLED'
            AND metrics.clicks >= {min_clicks}
        ORDER BY metrics.cost_micros DESC
    """

    try:
        response = ga_service.search(customer_id=customer_id, query=query)
    except GoogleAdsException as e:
        print(f"    ⚠️  API error: {e.failure.errors[0].message}")
        return

    actions_taken = 0
    for row in response:
        cost = row.metrics.cost_micros / 1_000_000
        conversions = row.metrics.conversions
        campaign_name = row.campaign.name
        budget_micros = row.campaign_budget.amount_micros
        budget_resource = row.campaign_budget.resource_name
        current_budget = budget_micros / 1_000_000

        cpl_target = get_cpl_target(company_config, campaign_name)

        if conversions > 0:
            cpl = cost / conversions
        elif cost > 0:
            cpl = float("inf")
        else:
            continue

        # Rule 3: Scale UP if CPL is under target and budget allows
        if cpl < cpl_target * 0.8 and conversions >= 2:
            new_budget_micros = int(budget_micros * scale_up)
            new_budget_micros = min(new_budget_micros, int(daily_budget_limit))
            new_budget = new_budget_micros / 1_000_000

            if new_budget_micros > budget_micros:
                detail = f"CPL=${cpl:.2f} < target=${cpl_target} — budget ${current_budget:.2f} → ${new_budget:.2f}"

                if execute:
                    try:
                        budget_service = client.get_service("CampaignBudgetService")
                        operation = client.get_type("CampaignBudgetOperation")
                        budget = operation.update
                        budget.resource_name = budget_resource
                        budget.amount_micros = new_budget_micros
                        client.copy_from(operation.update_mask, client.get_type("FieldMask")(paths=["amount_micros"]))
                        budget_service.mutate_campaign_budgets(customer_id=customer_id, operations=[operation])
                        log_action(rules_log, company_key, "scale_budget_up", "campaign", row.campaign.id, campaign_name, "BUDGET_INCREASED", detail, True)
                    except GoogleAdsException as e:
                        print(f"    ❌ Failed to scale up '{campaign_name}': {e.failure.errors[0].message}")
                else:
                    log_action(rules_log, company_key, "scale_budget_up", "campaign", row.campaign.id, campaign_name, "WOULD_INCREASE", detail, False)
                actions_taken += 1

        # Rule 4: Scale DOWN if CPL exceeds target significantly
        elif cpl > cpl_target * 1.3:
            new_budget_micros = int(budget_micros * scale_down)
            min_budget_micros = 1_000_000  # $1 minimum
            new_budget_micros = max(new_budget_micros, min_budget_micros)
            new_budget = new_budget_micros / 1_000_000

            if new_budget_micros < budget_micros:
                detail = f"CPL=${cpl:.2f} > target=${cpl_target} — budget ${current_budget:.2f} → ${new_budget:.2f}"

                if execute:
                    try:
                        budget_service = client.get_service("CampaignBudgetService")
                        operation = client.get_type("CampaignBudgetOperation")
                        budget = operation.update
                        budget.resource_name = budget_resource
                        budget.amount_micros = new_budget_micros
                        client.copy_from(operation.update_mask, client.get_type("FieldMask")(paths=["amount_micros"]))
                        budget_service.mutate_campaign_budgets(customer_id=customer_id, operations=[operation])
                        log_action(rules_log, company_key, "scale_budget_down", "campaign", row.campaign.id, campaign_name, "BUDGET_DECREASED", detail, True)
                    except GoogleAdsException as e:
                        print(f"    ❌ Failed to scale down '{campaign_name}': {e.failure.errors[0].message}")
                else:
                    log_action(rules_log, company_key, "scale_budget_down", "campaign", row.campaign.id, campaign_name, "WOULD_DECREASE", detail, False)
                actions_taken += 1

    if actions_taken == 0:
        print("    ✅ All campaign budgets are appropriately scaled")


# ─── Main ────────────────────────────────────────────────────────────────────

def run_rules_for_company(client, company_key, company_config, rules_config, rules_log, execute):
    """Run all rules for a single company."""
    customer_id = company_config.get("google_ads_id")
    if not customer_id:
        print(f"\n  ⏭️  Skipping {company_key} — no Google Ads ID configured")
        return

    company_name = company_config.get("name", company_key)
    print(f"\n{'='*60}")
    print(f"  Running rules for: {company_name} (ID: {customer_id})")
    mode = "LIVE EXECUTION" if execute else "DRY RUN (preview only)"
    print(f"  Mode: {mode}")
    print(f"{'='*60}")

    rule_pause_high_cpl_keywords(client, customer_id, company_key, company_config, rules_config, rules_log, execute)
    rule_pause_low_ctr_ads(client, customer_id, company_key, company_config, rules_config, rules_log, execute)
    rule_scale_budgets(client, customer_id, company_key, company_config, rules_config, rules_log, execute)


def main():
    parser = argparse.ArgumentParser(description="Google Ads Automated Rules Engine")
    parser.add_argument("--company", help="Run rules for a specific company (e.g., worthey-aquatics, overassessed)")
    parser.add_argument("--all", action="store_true", help="Run rules for all companies with Google Ads")
    parser.add_argument("--execute", action="store_true", help="Actually execute changes (default is dry run)")
    args = parser.parse_args()

    if not args.company and not args.all:
        parser.error("Specify --company <name> or --all")

    client, marketing = load_configs()
    companies = marketing.get("companies", {})
    rules_config = marketing.get("rules", {})
    rules_log = load_rules_log()

    if args.execute:
        print("\n  ⚠️  LIVE EXECUTION MODE — Changes will be applied to Google Ads!")
        confirm = input("  Type 'yes' to confirm: ").strip().lower()
        if confirm != "yes":
            print("  Aborted.")
            sys.exit(0)

    if args.all:
        for key, config in companies.items():
            run_rules_for_company(client, key, config, rules_config, rules_log, args.execute)
    else:
        if args.company not in companies:
            print(f"ERROR: Company '{args.company}' not found in marketing-config.json")
            print(f"Available: {', '.join(companies.keys())}")
            sys.exit(1)
        run_rules_for_company(client, args.company, companies[args.company], rules_config, rules_log, args.execute)

    save_rules_log(rules_log)
    print(f"\n  📝 Rules log updated: {RULES_LOG} ({len(rules_log)} total entries)")


if __name__ == "__main__":
    main()
