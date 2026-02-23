# Fish completion for claude-code-core (claude-core)
# Copy to ~/.config/fish/completions/claude-core.fish

# Options
complete -c claude-core -l model -s m -d "Model to use" -xa "opus sonnet haiku 4o 4o-mini 4-turbo"
complete -c claude-core -l max-turns -d "Max agentic turns" -x
complete -c claude-core -s p -l prompt -d "One-shot prompt" -x
complete -c claude-core -l system-prompt -d "Custom system prompt" -x
complete -c claude-core -l thinking-budget -d "Thinking budget in tokens" -x
complete -c claude-core -l permission-mode -d "Permission mode" -xa "default acceptEdits bypassPermissions plan"
complete -c claude-core -s r -l resume -d "Resume session" -x
complete -c claude-core -s v -l verbose -d "Verbose output"
complete -c claude-core -s h -l help -d "Show help"

# Also complete for the full name
complete -c claude-code-core -w claude-core
