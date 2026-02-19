import { OptionDefaults } from "typedoc";

/** @type {Partial<import('typedoc').TypeDocOptions>} */
const config = {
  readme: "README.md",
  headings: {
    readme: false,
  },
  gitRevision: "main",
  projectDocuments: [
    "docs/overview.md",
    "docs/quickstart.md",
    "docs/agent-skills.md",
    "docs/testing-mcp-apps.md",
    "docs/patterns.md",
    "docs/migrate_from_openai_apps.md",
  ],
  entryPoints: [
    "src/server/index.ts",
    "src/app.ts",
    "src/react/index.tsx",
    "src/app-bridge.ts",
    "src/message-transport.ts",
    "src/types.ts",
  ],
  excludePrivate: true,
  excludeInternal: false,
  intentionallyNotExported: ["AppOptions"],
  blockTags: [...OptionDefaults.blockTags, "@description"],
  jsDocCompatibility: {
    exampleTag: false,
  },
  includeVersion: true,
  categorizeByGroup: true,
  navigation: {
    includeGroups: true,
  },
  navigationLinks: {
    GitHub: "https://github.com/modelcontextprotocol/ext-apps",
    Specification:
      "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx",
  },
  out: "docs/api",
  plugin: [
    "typedoc-github-theme",
    "./scripts/typedoc-plugin-fix-mermaid-entities.mjs",
    "@boneskull/typedoc-plugin-mermaid",
  ],
  ignoredHighlightLanguages: ["mermaid"],
};

export default config;
