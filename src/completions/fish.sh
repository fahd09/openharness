# Fish completion for openharness
# Copy to ~/.config/fish/completions/openharness.fish

# Options
complete -c openharness -l model -s m -d "Model to use" -xa "opus sonnet haiku 4o 4o-mini 4-turbo flash pro"
complete -c openharness -l max-turns -d "Max agentic turns" -x
complete -c openharness -s p -l prompt -d "One-shot prompt" -x
complete -c openharness -l system-prompt -d "Custom system prompt" -x
complete -c openharness -l thinking-budget -d "Thinking budget in tokens" -x
complete -c openharness -l permission-mode -d "Permission mode" -xa "default acceptEdits bypassPermissions plan"
complete -c openharness -s r -l resume -d "Resume session" -x
complete -c openharness -s v -l verbose -d "Verbose output"
complete -c openharness -s h -l help -d "Show help"
