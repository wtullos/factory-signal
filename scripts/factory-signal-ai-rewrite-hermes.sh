#!/usr/bin/env bash
set -euo pipefail

# Safe Hermes wrapper for the Factory Signal review-publish receiver.
#
# Privacy / safety notes:
# - `--ignore-rules` tells Hermes not to load AGENTS/SOUL/rules, memory, or
#   preloaded skills for this one-shot rewrite. The prompt itself already
#   contains the full task constraints and article inputs the model may use.
# - `--toolsets safe` plus `--max-turns 1` prevents tool access and keeps
#   the invocation to a single response.
# - The Hermes CLI currently accepts the user prompt via `-q`; that means the
#   prompt can be visible to same-host process-list observers while Hermes runs.
#   This wrapper still reads the receiver prompt from stdin so the receiver does
#   not need to put it in FS_REVIEW_AI_REWRITE_COMMAND, but it cannot fully hide
#   the prompt until the CLI supports stdin/file prompt input.
#
# Expected receiver config:
#   FS_REVIEW_AI_REWRITE=true
#   FS_REVIEW_AI_REWRITE_COMMAND='["scripts/factory-signal-ai-rewrite-hermes.sh"]'

prompt=$(cat)

if [[ -z "${prompt}" ]]; then
  printf 'factory-signal-ai-rewrite-hermes: empty prompt on stdin\n' >&2
  exit 64
fi

hermes_bin=/home/wtullos/.local/bin/hermes
if [[ ! -x "${hermes_bin}" ]]; then
  printf 'factory-signal-ai-rewrite-hermes: Hermes executable not found: %s\n' "${hermes_bin}" >&2
  exit 127
fi

set +e
output=$("${hermes_bin}" chat \
  -Q \
  --ignore-rules \
  --source factory-signal-review \
  --toolsets safe \
  --max-turns 1 \
  -q "${prompt}" 2>&1)
status=$?
set -e

# Hermes prints a bookkeeping line such as `session_id: ...` before the final
# assistant text. It may arrive on stdout or stderr depending on CLI version.
# The receiver expects the revised Markdown body only, so remove any session_id
# line while preserving the model's body text exactly otherwise.
filtered_output=$(printf '%s\n' "${output}" | grep -Ev '^[[:space:]]*session_id:[[:space:]]*' || true)

if [[ ${status} -ne 0 ]]; then
  printf '%s\n' "${filtered_output}" >&2
  exit "${status}"
fi

printf '%s\n' "${filtered_output}"
