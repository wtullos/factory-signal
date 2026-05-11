#!/bin/bash
set -e
cd /home/wtullos/.openclaw/workspace/briefings-app
if [ -d node_modules ]; then
  npm run dev
else
  echo "node_modules not found; falling back to legacy server.js. Run npm install for Astro preview."
  node server.js
fi
