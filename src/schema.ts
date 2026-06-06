import { z } from "zod";

const targetSchema = z.enum(["claude", "codex", "opencode"]);

const permissionSchema = z.enum(["readonly", "safe-write", "write", "command"]);

export const agentSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().min(20),
  version: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  permission: permissionSchema,
  recommendedTargets: z.array(targetSchema).min(1),
  prompt: z.string().min(80),
  model: z
    .object({
      claude: z.string().optional(),
      codex: z.string().optional(),
      opencode: z.string().optional()
    })
    .optional(),
  tools: z
    .object({
      read: z.boolean().optional(),
      edit: z.boolean().optional(),
      write: z.boolean().optional(),
      bash: z.enum(["none", "safe", "full"]).optional(),
      web: z.boolean().optional()
    })
    .optional(),
  provenance: z
    .object({
      source: z.string().optional(),
      repository: z.string().optional(),
      license: z.string().optional(),
      author: z.string().optional(),
      importedAt: z.string().optional()
    })
    .optional()
});

export const packSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().min(20),
  version: z.string().min(1),
  tags: z.array(z.string()).default([]),
  agents: z.array(z.string()).min(1),
  recommendedFor: z
    .object({
      frameworks: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
      files: z.array(z.string()).optional()
    })
    .default({}),
  requires: z
    .object({
      agentsMarket: z.string().min(1).optional()
    })
    .optional()
});

export const changelogEntrySchema = z.object({
  version: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().min(20),
  added: z.array(z.string()).optional(),
  changed: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional()
});

export const registrySchema = z.object({
  agents: z.array(agentSchema),
  packs: z.array(packSchema),
  changelog: z.array(changelogEntrySchema).optional()
});

export const registrySignatureSchema = z.object({
  keyId: z.string().min(1),
  algorithm: z.literal("ed25519"),
  signature: z.string().min(1)
});

export const registryBundleSchema = registrySchema.extend({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  exportedAt: z.string().min(1),
  signatures: z.array(registrySignatureSchema).optional(),
  sha256: z.string().optional()
});
