#!/bin/bash
# Start Cloudflare tunnel and update CRM with the URL
cd /Users/aquabot/Documents/WortheyFlow/server

# Start tunnel, capture URL
cloudflared tunnel --url http://localhost:3001 2>&1 | while read line; do
    echo "$line"
    # Extract the tunnel URL
    url=$(echo "$line" | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com')
    if [ -n "$url" ]; then
        echo "$url" > /Users/aquabot/Documents/WortheyFlow/server/tunnel-url.txt
        echo "Tunnel URL saved: $url"
        # Update app.js with new URL
        sed -i '' "s|return s.apiUrl || 'https://[^']*'|return s.apiUrl || '$url'|" /Users/aquabot/Documents/WortheyFlow/app.js
        sed -i '' "s|placeholder=\"https://[^\"]*\"|placeholder=\"$url\"|" /Users/aquabot/Documents/WortheyFlow/app.js
        # Redeploy to surge
        cd /Users/aquabot/Documents/WortheyFlow && npx surge . wortheyflow.surge.sh 2>&1
        cd /Users/aquabot/Documents/WortheyFlow/server
    fi
done
