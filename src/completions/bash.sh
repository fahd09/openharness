#!/usr/bin/env bash
# Bash completion for claude-code-core (claude-core)
# Add to ~/.bashrc: source /path/to/completions/bash.sh

_claude_core_completions() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local prev="${COMP_WORDS[COMP_CWORD-1]}"

  # Top-level options
  local opts="--model -m --max-turns -p --prompt --system-prompt --thinking-budget --permission-mode --resume -r --verbose -v --help -h"

  # Model options
  local models="opus sonnet haiku 4o 4o-mini 4-turbo"

  # Permission modes
  local modes="default acceptEdits bypassPermissions plan"

  case "$prev" in
    --model|-m)
      COMPREPLY=( $(compgen -W "$models" -- "$cur") )
      return 0
      ;;
    --permission-mode)
      COMPREPLY=( $(compgen -W "$modes" -- "$cur") )
      return 0
      ;;
    -p|--prompt|--system-prompt|--resume|-r|--thinking-budget|--max-turns)
      # These take a value argument — no completion
      return 0
      ;;
  esac

  # Default: complete options
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
    return 0
  fi
}

complete -o default -F _claude_core_completions claude-core
complete -o default -F _claude_core_completions claude-code-core
