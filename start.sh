#!/bin/bash

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"

echo "Starting AlphaShield..."

osascript <<EOF
tell application "Warp"
    activate
end tell
delay 1

tell application "System Events"
    tell process "Warp"
        -- Tab 1: FastAPI backend
        keystroke "n" using {command down}
        delay 1
        keystroke "cd \"$PROJECT_DIR/backend\" && source .venv/bin/activate && uvicorn main:app --reload --port 8005"
        delay 0.2
        keystroke return

        -- Tab 2: Midnight Node.js service
        delay 0.5
        keystroke "t" using {command down}
        delay 1
        keystroke "cd \"$PROJECT_DIR/midnight-service\" && npm start"
        delay 0.2
        keystroke return

        -- Tab 3: React frontend
        delay 0.5
        keystroke "t" using {command down}
        delay 1
        keystroke "cd \"$PROJECT_DIR/frontend\" && npm run dev"
        delay 0.2
        keystroke return
    end tell
end tell
EOF

echo "Done. Services starting on:"
echo "  Frontend:         http://localhost:3005"
echo "  Backend:          http://localhost:8005"
echo "  Midnight service: http://localhost:3006"
