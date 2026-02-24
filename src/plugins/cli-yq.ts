import { createCliToolPlugin } from "./cli-tool.js";

export const cliYqPlugin = createCliToolPlugin({
  command: "yq",
  description:
    "yq — YAML/XML processor. Like jq but for YAML files.",
  examples: [
    "yq '.services' docker-compose.yml       # Extract services from compose file",
    "yq '.spec.containers[0].image' pod.yaml  # Get container image from K8s manifest",
    "yq -i '.version = \"2.0\"' config.yaml    # Edit YAML file in place",
  ],
  notes:
    "Use yq for YAML/XML. Syntax is similar to jq. Use -i for in-place editing.",
});
