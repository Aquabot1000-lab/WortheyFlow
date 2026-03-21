#!/usr/bin/env python3
"""
Google Ads OAuth2 Token Generator
Generates a refresh token for Google Ads API access.
Reads client_id and client_secret from google-ads-config.yaml.
"""

import sys
import os
import yaml
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/adwords"]
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "google-ads-config.yaml")


def load_config():
    """Load OAuth credentials from google-ads-config.yaml."""
    if not os.path.exists(CONFIG_FILE):
        print(f"ERROR: Config file not found: {CONFIG_FILE}")
        print("Create google-ads-config.yaml with:")
        print("  client_id: YOUR_CLIENT_ID")
        print("  client_secret: YOUR_CLIENT_SECRET")
        print("  developer_token: YOUR_DEVELOPER_TOKEN")
        print("  login_customer_id: YOUR_MCC_ID (no dashes)")
        sys.exit(1)

    with open(CONFIG_FILE, "r") as f:
        config = yaml.safe_load(f)

    required = ["client_id", "client_secret"]
    for key in required:
        if key not in config:
            print(f"ERROR: Missing '{key}' in {CONFIG_FILE}")
            sys.exit(1)

    return config


def generate_refresh_token(config):
    """Run OAuth2 flow to generate a refresh token."""
    client_config = {
        "installed": {
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)

    print("=" * 60)
    print("Google Ads OAuth2 Token Generator")
    print("=" * 60)
    print()
    print("A browser window will open for authentication.")
    print("Sign in with the Google account that has Ads access.")
    print()

    # Run local server for OAuth callback
    credentials = flow.run_local_server(port=8080)

    refresh_token = credentials.refresh_token

    print()
    print("=" * 60)
    print("SUCCESS! Your refresh token:")
    print("=" * 60)
    print()
    print(f"  {refresh_token}")
    print()
    print("Add this to your google-ads-config.yaml:")
    print(f"  refresh_token: {refresh_token}")
    print()

    # Optionally update the config file
    update = input("Update google-ads-config.yaml automatically? (y/n): ").strip().lower()
    if update == "y":
        config["refresh_token"] = refresh_token
        with open(CONFIG_FILE, "w") as f:
            yaml.dump(config, f, default_flow_style=False)
        print(f"Updated {CONFIG_FILE}")
    else:
        print("Copy the refresh_token above and add it to your config manually.")

    return refresh_token


def main():
    config = load_config()
    generate_refresh_token(config)


if __name__ == "__main__":
    main()
