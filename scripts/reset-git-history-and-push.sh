#!/bin/bash
set -e

# Resolve the repo root relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Create a new orphan branch (no parent commits)
git checkout --orphan latest_branch

# Stage all files
git add -A

# Commit
git commit -m "Initial commit"

# Delete the old main branch
git branch -D main

# Rename current branch to main
git branch -m main

# Force push
git push -f origin main
