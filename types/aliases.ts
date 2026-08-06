import type { Database } from './database';

/* ============================================================================
 * DATABASE TYPE ALIASES
 * ----------------------------------------------------------------------------
 * Short names for the generated enums and rows, so application code says
 * `InvitationPurpose` rather than
 * `Database['public']['Enums']['invitation_purpose']`.
 *
 * types/database.ts is GENERATED and never hand-edited (registry C-16). This
 * file is the hand-written layer on top — which is why it contains only
 * aliases: anything more would be a second declaration of the schema and could
 * drift from it.
 * ========================================================================= */

type Enums = Database['public']['Enums'];
type Tables = Database['public']['Tables'];

export type InvitationPurpose = Enums['invitation_purpose'];
export type AccountState = Enums['account_state'];
export type AuthProvider = Enums['auth_provider'];
export type LoginOutcomeDb = Enums['login_outcome'];
export type MfaTypeDb = Enums['mfa_type'];
export type SecuritySeverity = Enums['security_severity'];
export type AuditOutcome = Enums['audit_outcome'];
export type UserRoleDb = Enums['user_role'];
export type ThemePreferenceDb = Enums['theme_preference'];

export type UserRow = Tables['users']['Row'];
export type SessionRow = Tables['sessions']['Row'];
export type InvitationRow = Tables['invitations']['Row'];
export type MfaFactorRow = Tables['mfa_factors']['Row'];
export type SkillRow = Tables['skills']['Row'];
