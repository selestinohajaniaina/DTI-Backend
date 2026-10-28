/**
 * Ownership of a photo-to-ideas generation. Exactly one variant applies per
 * record: authenticated callers are identified by their verified user id,
 * anonymous callers by a stable random UUID (client-presented and validated,
 * or server-issued and echoed back for reuse).
 */
export type GenerationOwnership =
  { kind: 'user'; userId: string } | { kind: 'anonymous'; anonymousOwnerId: string };
