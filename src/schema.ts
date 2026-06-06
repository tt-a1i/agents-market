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
    .default({})
});

export const registrySchema = z.object({
  agents: z.array(agentSchema),
  packs: z.array(packSchema)
});

export const registryBundleSchema = registrySchema.extend({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  exportedAt: z.string().min(1),
  sha256: z.string().optional()
});
