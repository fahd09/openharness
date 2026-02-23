#!/usr/bin/env zsh
# Zsh completion for claude-code-core (claude-core)
# Add to ~/.zshrc: source /path/to/completions/zsh.sh

_claude_core() {
  local -a opts models modes

  opts=(
    '--model[Model to use]:model:->models'
    '-m[Model to use]:model:->models'
    '--max-turns[Max agentic turns]:turns:'
    '-p[One-shot prompt]:prompt:'
    '--prompt[One-shot prompt]:prompt:'
    '--system-prompt[Custom system prompt]:prompt:'
    '--thinking-budget[Thinking budget in tokens]:tokens:'
    '--permission-mode[Permission mode]:mode:->modes'
    '-r[Resume session]:session_id:'
    '--resume[Resume session]:session_id:'
    '-v[Verbose output]'
    '--verbose[Verbose output]'
    '-h[Show help]'
    '--help[Show help]'
  )

  models=(opus sonnet haiku 4o 4o-mini 4-turbo)
  modes=(default acceptEdits bypassPermissions plan)

  _arguments -s $opts

  case $state in
    models)
      _describe 'model' models
      ;;
    modes)
      _describe 'mode' modes
      ;;
  esac
}

compdef _claude_core claude-core
compdef _claude_core claude-code-core
