#!/bin/sh
# Temporary diagnostics for a Vercel build failure where the client's tsc
# step can't resolve react/react-router-dom/@dnd-kit/lucide-react despite
# `npm install` reporting success. Prints what's actually on disk before
# handing off to the real build, so the log shows ground truth instead of
# guesses. Safe to delete once the underlying issue is understood.
set -e

echo "--- node/npm versions ---"
node -v
npm -v

echo "--- root node_modules package count ---"
ls node_modules | wc -l

echo "--- react present in root node_modules? ---"
ls -la node_modules/react 2>&1 || echo "NOT FOUND"

echo "--- client node_modules entries (if any; workspaces usually hoist to root) ---"
ls client/node_modules 2>&1 | wc -l

echo "--- npm ls react from client workspace ---"
npm ls react --workspace client 2>&1 || true

echo "--- running real build ---"
npm run build --workspace client
