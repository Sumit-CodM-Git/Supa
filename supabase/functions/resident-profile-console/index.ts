import { type AuthContext, requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { validateEmail } from "../_shared/validation.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const logger = createLogger("resident-profile-console");

const ENFORCE_STAFF_ROLE =
  (Deno.env.get("ENFORCE_STAFF_ROLE") ?? "true").toLowerCase() === "true";

const STAFF_ROLES = [
  "society_admin",
  "admin",
  "committee",
  "committee_member",
  "secretary",
  "manager",
  "treasurer",
  "facility_manager",
];

// ---- Enum whitelists (canonical casing preserved on write) ----
const GENDER_VALUES = ["Male", "Female", "Other"] as const;
const USER_TYPE_VALUES = [
  "Owner",
  "Tenant",
  "Family Member",
  "Staff",
] as const;
const OWNERSHIP_TYPE_VALUES = [
  "Owned",
  "Rented",
  "Leased",
  "Family",
] as const;
const ID_PROOF_TYPE_VALUES = [
  "Aadhaar",
  "PAN",
  "Passport",
  "Driving License",
  "Voter ID",
] as const;
// const VEHICLE_TYPE_VALUES = [
//    "two_wheeler",
//   "four_wheeler",
// ] as const;
const VEHICLE_TYPE_VALUES = [
  "Two Wheeler",
  "Four Wheeler",
  "None",
] as const;

// ---- Staff-only fields: self-updates cannot touch these ----
const STAFF_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "flatNumber",
  "block",
  "tower",
  "moveInDate",
  "moveOutDate",
  "status",
  "userType",
  "userOwnershipType",
  "role",
]);

// ---- Format patterns ----
// Name: starts with a letter, then 1–99 letters/spaces/./'/- (total 2–100)
const NAME_PATTERN = /^\p{L}[\p{L}\s.'-]{1,99}$/u;
// Phone: optional +, 10–15 digits (after stripping spaces/dashes/parens)
const PHONE_PATTERN = /^\+?\d{10,15}$/;
// Aadhaar: 12 digits, first digit 2–9, optional spaces
const AADHAAR_PATTERN = /^[2-9]\d{3}\s?\d{4}\s?\d{4}$/;
// PAN: 5 letters, 4 digits, 1 letter
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// Passport (India)
const PASSPORT_PATTERN = /^[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]$/;
// Driving License (India, lenient)
const DL_PATTERN = /^[A-Z]{2}[0-9]{2}\s?[0-9]{11}$/i;
// Indian vehicle registration (lenient)
const VEHICLE_REG_PATTERN =
  /^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{1,3}\s?[0-9]{4}$/i;

// Max lengths
const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;
const MAX_OCCUPATION = 100;
const MAX_EMAIL = 254;

// ============================================
// TYPES
// ============================================
type ActionType = "FETCH_ONE" | "FETCH_ALL" | "UPDATE";

interface MergedRequest {
  actionType?: ActionType;
  operation?: string;
  societyRegistrationNumber: string;
  residentId?: string;
  role?: string;
  page?: number | string;
  limit?: number | string;
  search?: string;
  filterRole?: string;
  filterStatus?: boolean | string;
  filterUserType?: string;
  filterUserOwnershipType?: string;
  filterTower?: string;
  filterBlock?: string;
  // UPDATE fields
  name?: string | null;
  description?: string | null;
  gender?: string | null;
  occupation?: string | null;
  idProofType?: string | null;
  idProofNumber?: string | null;
  vehicleType?: string | null;
  vehicleRegNo?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsAppPhone?: string | null;
  emergencyPhone?: string | null;
  flatNumber?: string | null;
  status?: boolean | string | null;
  userType?: string | null;
  userOwnershipType?: string | null;
  moveInDate?: string | null;
  moveOutDate?: string | null;
  block?: string | null;
  tower?: string | null;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

interface ContactRecord {
  contact_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp_phone?: string | null;
  gender?: string | null;
  emergency_phone?: string | null;
  occupation?: string | null;
  vehicle_type?: string | null;
  vehicle_registration_number?: string | null;
  id_proof_type?: string | null;
  id_proof_number?: string | null;
  description?: string | null;
}

interface BlockRecord {
  block_id?: string | null;
  block_name?: string | null;
}
interface TowerRecord {
  tower_id?: string | null;
  name?: string | null;
}

interface ResidentProfileRecord {
  user_id?: string | null;
  role?: string[] | string | null;
  user_type?: string | null;
  unit_flat_number?: string | null;
  user_ownership_type?: string | null;
  status?: boolean | null;
  move_in_date?: string | null;
  move_out_date?: string | null;
  contact?: ContactRecord | ContactRecord[] | null;
  SSP_Block?: BlockRecord | BlockRecord[] | null;
  SSP_Tower?: TowerRecord | TowerRecord[] | null;
}

interface SocietyContext {
  society_id: string;
  society_name?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

interface TargetResident {
  user_id: string;
  role: string[] | null;
  contact:
    | { contact_id: string; name: string }
    | { contact_id: string; name: string }[]
    | null;
}

// ============================================
// FIELD VALIDATION ERROR
// ============================================
class FieldValidationError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "FieldValidationError";
    this.field = field;
  }
}

// ============================================
// INIT
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS (existing)
// ============================================
// deno-lint-ignore no-explicit-any

function capitalizeName(name: string): string {
  return name.trim().toLowerCase().replace(
    /(^|[\s'’-])(\p{L})/gu,
    (_, separator, letter) => `${separator}${letter.toUpperCase()}`,
  );
}
function asPayload(obj: Record<string, unknown>): any {
  return obj;
}
function mapVehicleToApp(dbValue: string | null | undefined): string {
  if (!dbValue) return "none";
  const v = dbValue.toLowerCase();
  if (v.includes("two")) return "two_wheeler";
  if (v.includes("four")) return "four_wheeler";
  return "none";
}

function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
  return arr;
}

function isStaffRole(role: unknown): boolean {
  if (!role) return false;
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((r) => {
    if (typeof r !== "string") return false;
    return STAFF_ROLES.includes(r.toLowerCase().trim());
  });
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function buildProfile(record: ResidentProfileRecord, society: SocietyContext) {
  const rawContact = firstOrNull(record.contact);
  const rawBlock = firstOrNull(record.SSP_Block);
  const rawTower = firstOrNull(record.SSP_Tower);

  const derivedSocietyName = society.society_name ?? "NA";
  const derivedCity = society.city ?? "NA";
  const derivedState = society.state ?? "NA";
  const derivedPincode = society.postal_code ?? "NA";

  return {
    userId: record.user_id ?? "NA",
    personalInformation: {
      Name: capitalizeName(String(rawContact?.name ?? "NA")),
      gender: String(rawContact?.gender ?? "NA"),
      occupation: String(rawContact?.occupation ?? "NA"),
      idProoftype: String(rawContact?.id_proof_type ?? "NA"),
      idProofNumber: String(rawContact?.id_proof_number ?? "NA"),
      //vehicleType: String(rawContact?.vehicle_type ?? "NA"),
      vehicleType: mapVehicleToApp(rawContact?.vehicle_type),
      vehicleRegistrationNumber: String(
        rawContact?.vehicle_registration_number ?? "NA",
      ),
    },
    contactInformation: {
      contactID: String(rawContact?.contact_id ?? "NA"),
      email: String(rawContact?.email ?? "NA"),
      phone: String(rawContact?.phone ?? "NA"),
      whatsAppPhone: String(rawContact?.whatsapp_phone ?? "NA"),
      emergencyPhone: String(rawContact?.emergency_phone ?? "NA"),
    },
    residentialInformation: {
      society: derivedSocietyName,
      flatNumber: record.unit_flat_number ?? "NA",
      block: String(rawBlock?.block_name ?? "NA"),
      tower: String(rawTower?.name ?? "NA"),
      city: derivedCity,
      pincode: derivedPincode,
      state: derivedState,
      role: Array.isArray(record.role)
        ? record.role.join(", ")
        : (record.role ?? "NA"),
      userType: record.user_type ?? "NA",
      ownershipType: record.user_ownership_type ?? "NA",
      status: record.status ? "Active" : "Inactive",
    },
  };
}

function matchesRole(record: ResidentProfileRecord, wanted: string): boolean {
  const wantedLc = wanted.trim().toLowerCase();
  const roleArray = Array.isArray(record.role)
    ? record.role.map((v) => String(v).trim().toLowerCase())
    : record.role
    ? [String(record.role).trim().toLowerCase()]
    : [];
  const userType = record.user_type
    ? String(record.user_type).trim().toLowerCase()
    : "";
  return roleArray.includes(wantedLc) || userType === wantedLc;
}

function resolveAction(body: MergedRequest): ActionType | null {
  if (body.actionType) {
    const a = String(body.actionType).trim().toUpperCase() as ActionType;
    if (a === "FETCH_ONE" || a === "FETCH_ALL" || a === "UPDATE") return a;
    return null;
  }
  if (body.operation) {
    const op = String(body.operation).trim().toUpperCase();
    if (op === "FETCH") return "FETCH_ALL";
    if (op === "UPDATE") return "UPDATE";
    return null;
  }
  if (body.residentId) return "FETCH_ONE";
  return null;
}

// ============================================
// HELPERS — sanitizers (renamed to avoid collision with shared module)
// ============================================
function sanitizeString(
  fieldName: string,
  value: unknown,
  maxLen?: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new FieldValidationError(fieldName, `Field '${fieldName}' must be a string.`);
  }
  const trimmed = value.trim();
  if (maxLen !== undefined && trimmed.length > maxLen) {
    throw new FieldValidationError(
      fieldName,
      `Field '${fieldName}' must be at most ${maxLen} characters.`,
    );
  }
  return trimmed;
}

function sanitizeDate(fieldName: string, value: unknown): string | null {
  if (!value) return null;
  const dateStr = String(value).trim();
  if (isNaN(Date.parse(dateStr))) {
    throw new FieldValidationError(
      fieldName,
      `Field '${fieldName}' must be a valid ISO date string (YYYY-MM-DD).`,
    );
  }
  return dateStr;
}

// ============================================
// HELPERS — new validators
// ============================================

/**
 * Validates the resident's full name.
 * Rule: "First name is mandatory" — the first whitespace-separated token
 * must be at least 2 letters. Whole name must be 2–100 chars and contain
 * only letters, spaces, dots, apostrophes and hyphens.
 */
function validateName(field: string, value: unknown): string {
  if (value === null || value === undefined) {
    throw new FieldValidationError(field, `Field '${field}' is required.`);
  }
  if (typeof value !== "string") {
    throw new FieldValidationError(field, `Field '${field}' must be a string.`);
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    throw new FieldValidationError(field, `Field '${field}' is required.`);
  }
  if (trimmed.length < 2 || trimmed.length > MAX_NAME) {
    throw new FieldValidationError(
      field,
      `Field '${field}' must be between 2 and ${MAX_NAME} characters.`,
    );
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new FieldValidationError(
      field,
      `Field '${field}' contains invalid characters. Only letters, spaces, dots, apostrophes and hyphens are allowed.`,
    );
  }
  // First name is mandatory
  const firstToken = trimmed.split(" ")[0];
  if (!firstToken || firstToken.length < 2) {
    throw new FieldValidationError(
      field,
      `Field '${field}' must contain a valid first name (at least 2 characters).`,
    );
  }
  return trimmed;
}

/**
 * Validates and normalizes a phone number. Returns "" for empty input.
 * Accepts formats like "+91 98765 43210", "9876543210", "(987) 654-3210".
 * Normalizes to digits-only (with optional leading +).
 */
function validatePhoneNumber(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new FieldValidationError(field, `Field '${field}' must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const normalized = trimmed.replace(/[\s\-()]/g, "");
  if (!PHONE_PATTERN.test(normalized)) {
    throw new FieldValidationError(
      field,
      `Field '${field}' must be a valid phone number (10–15 digits, optional leading +).`,
    );
  }
  return normalized;
}

/**
 * Normalizes an enum token for comparison:
 *  - lowercase
 *  - collapses spaces, underscores, hyphens, dots to a single canonical form
 * This way "Two Wheeler", "two_wheeler", "TWO-WHEELER", "two.wheeler"
 * all resolve to the same canonical DB value.
 */
function normalizeEnumToken(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_.\-]+/g, "");
}

/**
 * Validates an enum value against a whitelist. Case- and separator-insensitive;
 * returns the canonical value from the whitelist. Returns null on empty/null.
 */
function validateEnum(
  field: string,
  value: unknown,
  allowed: readonly string[],
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new FieldValidationError(field, `Field '${field}' must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const needle = normalizeEnumToken(trimmed);
  const match = allowed.find((v) => normalizeEnumToken(v) === needle);

  if (!match) {
    throw new FieldValidationError(
      field,
      `Field '${field}' must be one of: ${allowed.join(", ")}.`,
    );
  }
  return match;
}

/**
 * Validates that idProofNumber matches the format implied by idProofType.
 * If either is missing, silently skips (fields are independently optional).
 */
function validateIdProofNumber(
  idProofType: string | null | undefined,
  idProofNumber: string,
): void {
  if (!idProofNumber || !idProofType) return;
  const type = idProofType.toLowerCase();
  let pattern: RegExp | null = null;
  let label = "";
  if (type === "aadhaar") {
    pattern = AADHAAR_PATTERN;
    label = "Aadhaar";
  } else if (type === "pan") {
    pattern = PAN_PATTERN;
    label = "PAN";
  } else if (type === "passport") {
    pattern = PASSPORT_PATTERN;
    label = "Passport";
  } else if (type === "driving license") {
    pattern = DL_PATTERN;
    label = "Driving License";
  }
  if (pattern && !pattern.test(idProofNumber)) {
    throw new FieldValidationError(
      "idProofNumber",
      `Field 'idProofNumber' does not match the required format for '${label}'.`,
    );
  }
}

/**
 * Validates an Indian vehicle registration number.
 */
function validateVehicleRegNo(value: string): void {
  if (!value) return;
  if (!VEHICLE_REG_PATTERN.test(value)) {
    throw new FieldValidationError(
      "vehicleRegNo",
      "Field 'vehicleRegNo' is not a valid vehicle registration number.",
    );
  }
}

/**
 * Ensures a non-staff caller isn't trying to modify staff-only fields.
 */
function assertStaffOnlyFieldsAllowed(
  body: MergedRequest,
  callerIsStaff: boolean,
): void {
  if (callerIsStaff) return;
  const record = body as unknown as Record<string, unknown>;
  for (const f of STAFF_ONLY_FIELDS) {
    if (record[f] !== undefined) {
      throw new FieldValidationError(
        f,
        `You don't have permission to update '${f}'. Only society staff can modify this field.`,
      );
    }
  }
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtxFromParam?: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx = authCtxFromParam ??
      (req as AuthenticatedRequest).authContext;

    if (!authCtx?.user?.id) {
      return errorResponse("Authentication context missing.", 401);
    }

    const userId = authCtx.user.id;
    const startTime = Date.now();

    try {
      logger.info({
        level: "info",
        timestamp: new Date().toISOString(),
        action: "resident_profile_console_start",
        userId,
        method: req.method,
        message: "Resident profile console request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => "");
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      let body: MergedRequest;
      try {
        body = JSON.parse(bodyText) as MergedRequest;
      } catch {
        return errorResponse("Invalid JSON in request body.", 400);
      }

      const { societyRegistrationNumber } = body;

      if (
        !societyRegistrationNumber ||
        String(societyRegistrationNumber).trim() === ""
      ) {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanAction = resolveAction(body);
      if (!cleanAction) {
        return errorResponse(
          "actionType is mandatory. Allowed: FETCH_ONE, FETCH_ALL, UPDATE. " +
            'Legacy: operation "FETCH" → FETCH_ALL, operation "UPDATE" → UPDATE, ' +
            "residentId alone → FETCH_ONE.",
          400,
        );
      }

      const cleanRegNo = String(societyRegistrationNumber).trim();

      const { data: societyContext, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select(
          "society_id, society_name, address_line1, city, state, postal_code",
        )
        .ilike("registration_number", cleanRegNo)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          timestamp: new Date().toISOString(),
          action: "resident_profile_console_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to verify society context.", 500);
      }
      if (!societyContext) {
        return errorResponse(
          "No society registration found matching the identifier provided.",
          404,
        );
      }

      const { data: membership } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", userId)
        .eq("society", societyContext.society_id)
        .maybeSingle();

      if (!membership) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "resident_profile_console_membership_denied",
          userId,
          societyId: societyContext.society_id,
        });
        return errorResponse("You are not a member of this society.", 403);
      }

      const callerIsStaff = isStaffRole(membership.role);

      // =====================================================================
      // ACTION 1: FETCH_ONE  (unchanged)
      // =====================================================================
      if (cleanAction === "FETCH_ONE") {
        const { residentId, role } = body;

        if (!residentId || String(residentId).trim() === "") {
          return errorResponse("residentId is mandatory.", 422);
        }

        const cleanResidentId = String(residentId).trim();
        const roleInput = role ? String(role).trim() : null;

        const isSelf = isUuid(cleanResidentId) && cleanResidentId === userId;
        if (ENFORCE_STAFF_ROLE && !isSelf && !callerIsStaff) {
          logger.warn({
            level: "warn",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_one_denied",
            userId,
            targetId: cleanResidentId,
          });
          return errorResponse(
            "You don't have permission to view another resident's profile.",
            403,
          );
        }

        const pageNum = Math.max(1, parseInt(String(body.page ?? 1)) || 1);
        const limitNum = Math.min(
          100,
          Math.max(1, parseInt(String(body.limit ?? 10)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        let userQuery = supabaseAdmin
          .from("SSP_Society_User")
          .select(`
            user_id, unit_flat_number, status, move_in_date, move_out_date,
            user_ownership_type, user_type, role,
            contact:SSP_Contact!inner(
              contact_id, name, phone, email, whatsapp_phone, gender,
              emergency_phone, occupation, vehicle_type, vehicle_registration_number,
              id_proof_type, id_proof_number
            ),
            SSP_Block!left ( block_name ),
            SSP_Tower!left ( name )
          `)
          .eq("society", societyContext.society_id);

        if (isUuid(cleanResidentId)) {
          userQuery = userQuery.eq("user_id", cleanResidentId);
        } else {
          userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
        }

        userQuery = userQuery.range(offset, offset + limitNum - 1);

        const { data: userRecords, error: userError } = await userQuery;

        if (userError) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_one_error",
            error: userError.message,
          });
          throw new Error(`Society user lookup failed: ${userError.message}`);
        }
        if (!userRecords || userRecords.length === 0) {
          return errorResponse(
            "No resident profile found for the provided details.",
            404,
          );
        }

        let filteredRecords = userRecords as unknown as ResidentProfileRecord[];
        if (roleInput) {
          filteredRecords = filteredRecords.filter((r) =>
            matchesRole(r, roleInput)
          );
        }

        if (filteredRecords.length === 0) {
          return errorResponse(
            `No resident profile matched the provided details with role "${roleInput}".`,
            404,
          );
        }

        const profiles = filteredRecords.map((r) =>
          buildProfile(r, societyContext as SocietyContext)
        );

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_profile_console_fetch_one_end",
          userId,
          targetId: cleanResidentId,
          returnedProfiles: profiles.length,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            profiles,
            pagination: {
              page: pageNum,
              limit: limitNum,
              retrievedRecords: userRecords.length,
              returnedProfiles: profiles.length,
            },
          }),
        );
      }

      // =====================================================================
      // ACTION 2: FETCH_ALL  (unchanged)
      // =====================================================================
      if (cleanAction === "FETCH_ALL") {
        if (ENFORCE_STAFF_ROLE && !callerIsStaff) {
          logger.warn({
            level: "warn",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_all_denied",
            userId,
          });
          return errorResponse(
            "You don't have permission to list residents.",
            403,
          );
        }

        const {
          search,
          filterRole,
          filterStatus,
          filterUserType,
          filterUserOwnershipType,
          filterTower,
          filterBlock,
        } = body;

        const pageNum = Math.max(1, parseInt(String(body.page ?? 1)) || 1);
        const limitNum = Math.min(
          100,
          Math.max(1, parseInt(String(body.limit ?? 10)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        const buildQuery = () => {
          let q = supabaseAdmin
            .from("SSP_Society_User")
            .select(
              `
              user_id,
              unit_flat_number,
              role,
              user_type,
              user_ownership_type,
              status,
              move_in_date,
              move_out_date,
              tower:SSP_Tower(tower_id, name),
              block:SSP_Block(block_id, block_name),
              contact:SSP_Contact!inner(
                contact_id,
                name,
                description,
                email,
                phone,
                whatsapp_phone,
                emergency_phone,
                gender,
                occupation,
                id_proof_type,
                id_proof_number,
                vehicle_type,
                vehicle_registration_number
              )
            `,
              { count: "exact" },
            )
            .eq("society", societyContext.society_id);

          if (
            filterStatus !== undefined && filterStatus !== null &&
            filterStatus !== ""
          ) {
            q = q.eq(
              "status",
              filterStatus === "true" || filterStatus === true,
            );
          }
          if (typeof filterUserType === "string" && filterUserType.trim()) {
            q = q.eq("user_type", filterUserType.trim());
          }
          if (
            typeof filterUserOwnershipType === "string" &&
            filterUserOwnershipType.trim()
          ) {
            q = q.eq("user_ownership_type", filterUserOwnershipType.trim());
          }
          if (filterTower) q = q.eq("tower", filterTower);
          if (filterBlock) q = q.eq("block", filterBlock);
          if (typeof filterRole === "string" && filterRole.trim()) {
            q = q.contains("role", [filterRole.trim()]);
          }
          return q;
        };

        let searchContactIds: string[] = [];
        if (typeof search === "string" && search.trim() !== "") {
          const term = search.trim();
          const { data: matchedContacts } = await supabaseAdmin
            .from("SSP_Contact")
            .select("contact_id")
            .or(
              `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
            );

          searchContactIds = (matchedContacts ?? [])
            .map((c: { contact_id: string }) => c.contact_id)
            .filter(Boolean);
        }

        const applySearch = <T>(q: T): T => {
          if (typeof search !== "string" || search.trim() === "") return q;
          const term = search.trim();
          // deno-lint-ignore no-explicit-any
          const qq = q as any;
          if (searchContactIds.length > 0) {
            return qq.or(
              `unit_flat_number.ilike.%${term}%,contact.in.(${
                searchContactIds.join(",")
              })`,
            ) as T;
          }
          return qq.ilike("unit_flat_number", `%${term}%`) as T;
        };

        const countQ = applySearch(
          buildQuery().select("user_id", { count: "exact", head: true }),
        );
        const { count: preCount, error: preCountErr } = await countQ;
        if (preCountErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_all_count_error",
            error: preCountErr.message,
          });
          throw new Error(`Count query failed: ${preCountErr.message}`);
        }

        const total = preCount ?? 0;

        if (total === 0 || offset >= total) {
          logger.info({
            level: "info",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_all_empty",
            userId,
            total,
            page: pageNum,
          });
          return successResponse(
            asPayload({
              residents: [],
              pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
              },
            }),
          );
        }

        const dataQ = applySearch(buildQuery())
          .range(offset, offset + limitNum - 1)
          .order("created_at", { ascending: false });

        const { data: records, error: fetchError } = await dataQ;

        if (fetchError) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_fetch_all_error",
            error: fetchError.message,
          });
          throw new Error(`Fetch failed: ${fetchError.message}`);
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_profile_console_fetch_all_end",
          userId,
          returned: (records ?? []).length,
          total,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            residents: records ?? [],
            pagination: {
              total,
              page: pageNum,
              limit: limitNum,
              totalPages: Math.ceil(total / limitNum),
            },
          }),
        );
      }

      // =====================================================================
      // ACTION 3: UPDATE  (validations added)
      // =====================================================================
      if (cleanAction === "UPDATE") {
        const { residentId } = body;

        if (!residentId || String(residentId).trim() === "") {
          return errorResponse(
            "residentId is mandatory for UPDATE operation.",
            400,
          );
        }

        const cleanResidentId = String(residentId).trim();

        // ---- Ownership gate: self OR staff ----
        const isSelf = isUuid(cleanResidentId) && cleanResidentId === userId;
        if (ENFORCE_STAFF_ROLE && !isSelf && !callerIsStaff) {
          logger.warn({
            level: "warn",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_update_denied",
            userId,
            targetId: cleanResidentId,
          });
          return errorResponse(
            "You don't have permission to update another resident's profile.",
            403,
          );
        }

        // ---- Field-level authorization: staff-only fields ----
        // Self-updates may NOT touch flatNumber, block, tower, moveIn/Out,
        // status, userType, userOwnershipType, or role.
        try {
          if (ENFORCE_STAFF_ROLE) {
            assertStaffOnlyFieldsAllowed(body, callerIsStaff);
          }
        } catch (e) {
          if (e instanceof FieldValidationError) {
            logger.warn({
              level: "warn",
              timestamp: new Date().toISOString(),
              action: "resident_profile_console_update_forbidden_field",
              userId,
              field: e.field,
            });
            return errorResponse(e.message, 403);
          }
          throw e;
        }

        // ---- Locate target resident ----
        let userQuery = supabaseAdmin
          .from("SSP_Society_User")
          .select(`
            user_id,
            role,
            contact:SSP_Contact!inner(contact_id, name)
          `)
          .eq("society", societyContext.society_id);

        if (isUuid(cleanResidentId)) {
          userQuery = userQuery.or(
            `user_id.eq.${cleanResidentId},contact.eq.${cleanResidentId}`,
          );
        } else {
          userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
        }

        const { data: rawUserRecords, error: userError } = await userQuery;

        if (userError) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_profile_console_update_lookup_error",
            error: userError.message,
          });
          throw new Error(`Resident retrieval failed: ${userError.message}`);
        }
        if (!rawUserRecords || rawUserRecords.length === 0) {
          return errorResponse("No resident profile found to update.", 404);
        }

        const userRecords = rawUserRecords as unknown as TargetResident[];

        // ---- Pick profile by role if specified ----
        let su = userRecords[0];
        if (body.role) {
          const targetRole = Array.isArray(body.role)
            ? String(body.role[0])
            : String(body.role);
          const matchedRoleProfile = userRecords.find(
            (r) =>
              r.role &&
              Array.isArray(r.role) &&
              r.role.some(
                (v: string) =>
                  v.toLowerCase() === targetRole.trim().toLowerCase(),
              ),
          );
          if (matchedRoleProfile) su = matchedRoleProfile;
        }

        // =================================================================
        // FIELD VALIDATION — all in one try/catch so bad input → 400
        // =================================================================
        const contactUpdates: Record<string, unknown> = {};
        const userUpdates: Record<string, unknown> = {};

        try {
          // ---------- SSP_Contact fields ----------
          if (body.name !== undefined) {
            // "First name is mandatory" — enforced by validateName
            contactUpdates.name = validateName("name", body.name);
          }
          if (body.description !== undefined) {
            const v = sanitizeString(
              "description",
              body.description,
              MAX_DESCRIPTION,
            );
            if (v !== null) contactUpdates.description = v;
          }
          if (body.gender !== undefined) {
            const v = validateEnum("gender", body.gender, GENDER_VALUES);
            if (v !== null) contactUpdates.gender = v;
          }
          if (body.occupation !== undefined) {
            const v = sanitizeString(
              "occupation",
              body.occupation,
              MAX_OCCUPATION,
            );
            if (v !== null) contactUpdates.occupation = v;
          }

          // ID proof type + number (with cross-field format check)
          let resolvedIdProofType: string | null | undefined = undefined;
          if (body.idProofType !== undefined) {
            const v = validateEnum(
              "idProofType",
              body.idProofType,
              ID_PROOF_TYPE_VALUES,
            );
            resolvedIdProofType = v;
            if (v !== null) contactUpdates.id_proof_type = v;
          }
          if (body.idProofNumber !== undefined) {
            const v = sanitizeString("idProofNumber", body.idProofNumber, 40);
            if (v !== null && v !== "") {
              // Validate against provided type (if provided in this request)
              if (resolvedIdProofType) {
                validateIdProofNumber(resolvedIdProofType, v);
              }
              contactUpdates.id_proof_number = v;
            } else if (v === "") {
              contactUpdates.id_proof_number = v;
            }
          }

          // Vehicle type + reg no (with cross-field)
          if (body.vehicleType !== undefined) {
            const v = validateEnum(
              "vehicleType",
              body.vehicleType,
              VEHICLE_TYPE_VALUES,
            );
            if (v !== null) contactUpdates.vehicle_type = v;
          }
          if (body.vehicleRegNo !== undefined) {
            const v = sanitizeString("vehicleRegNo", body.vehicleRegNo, 20);
            if (v !== null && v !== "") {
              validateVehicleRegNo(v);
              contactUpdates.vehicle_registration_number = v.toUpperCase();
            } else if (v === "") {
              contactUpdates.vehicle_registration_number = v;
            }
          }

          // Email
          if (body.email !== undefined) {
            const email = sanitizeString("email", body.email, MAX_EMAIL);
            if (email !== null) {
              if (email !== "" && !validateEmail(email)) {
                throw new FieldValidationError(
                  "email",
                  "Field 'email' must be a valid email address.",
                );
              }
              contactUpdates.email = email;
            }
          }

          // Phones
          if (body.phone !== undefined) {
            const v = validatePhoneNumber("phone", body.phone);
            if (v !== null) contactUpdates.phone = v;
          }
          if (body.whatsAppPhone !== undefined) {
            const v = validatePhoneNumber("whatsAppPhone", body.whatsAppPhone);
            if (v !== null) contactUpdates.whatsapp_phone = v;
          }
          if (body.emergencyPhone !== undefined) {
            const v = validatePhoneNumber(
              "emergencyPhone",
              body.emergencyPhone,
            );
            if (v !== null) contactUpdates.emergency_phone = v;
          }

          // Cross-field: emergencyPhone must differ from phone if both sent
          if (
            typeof contactUpdates.phone === "string" &&
            typeof contactUpdates.emergency_phone === "string" &&
            contactUpdates.phone !== "" &&
            contactUpdates.emergency_phone !== "" &&
            contactUpdates.phone === contactUpdates.emergency_phone
          ) {
            throw new FieldValidationError(
              "emergencyPhone",
              "Field 'emergencyPhone' must be different from 'phone'.",
            );
          }

          // ---------- SSP_Society_User fields ----------
          // These are staff-only (already enforced above), so any value
          // reaching this block is from staff.
          if (body.flatNumber !== undefined) {
            const v = sanitizeString("flatNumber", body.flatNumber, 20);
            if (v !== null) userUpdates.unit_flat_number = v.toUpperCase();
          }
          if (body.status !== undefined) {
            userUpdates.status =
              body.status === true || body.status === "true";
          }
          if (body.userType !== undefined) {
            const v = validateEnum("userType", body.userType, USER_TYPE_VALUES);
            if (v !== null) userUpdates.user_type = v;
          }
          if (body.userOwnershipType !== undefined) {
            const v = validateEnum(
              "userOwnershipType",
              body.userOwnershipType,
              OWNERSHIP_TYPE_VALUES,
            );
            if (v !== null) userUpdates.user_ownership_type = v;
          }
          if (body.moveInDate !== undefined) {
            const v = sanitizeDate("moveInDate", body.moveInDate);
            if (v !== null) userUpdates.move_in_date = v;
          }
          if (body.moveOutDate !== undefined) {
            const v = sanitizeDate("moveOutDate", body.moveOutDate);
            if (v !== null) userUpdates.move_out_date = v;
          }

          // Cross-field: moveOutDate must be after moveInDate when both present
          if (
            typeof userUpdates.move_in_date === "string" &&
            typeof userUpdates.move_out_date === "string" &&
            Date.parse(userUpdates.move_out_date as string) <=
              Date.parse(userUpdates.move_in_date as string)
          ) {
            throw new FieldValidationError(
              "moveOutDate",
              "Field 'moveOutDate' must be later than 'moveInDate'.",
            );
          }

                    if (body.role !== undefined) {
            // 1. Get the roles currently in the database
            const existingRoles = Array.isArray(su.role) ? su.role : [];
            
            // 2. Get the roles sent by the app
            let incomingRoles: string[] = [];
            if (Array.isArray(body.role)) {
              incomingRoles = body.role.map((r) => String(r).trim());
            } else if (typeof body.role === "string") {
              incomingRoles = [body.role.trim()];
            }

            // 3. Merge them and remove duplicates using a Set
            userUpdates.role = Array.from(new Set([...existingRoles, ...incomingRoles]));
          }// if (body.role !== undefined) {
          //   if (Array.isArray(body.role)) {
          //     userUpdates.role = (body.role as unknown[]).map((r) =>
          //       String(r).trim()
          //     );
          //   } else if (typeof body.role === "string") {
          //     userUpdates.role = [body.role.trim()];
          //   }
          // }

        } catch (e) {
          if (e instanceof FieldValidationError) {
            logger.warn({
              level: "warn",
              timestamp: new Date().toISOString(),
              action: "resident_profile_console_update_validation_error",
              userId,
              field: e.field,
              error: e.message,
            });
            return errorResponse(e.message, 400);
          }
          throw e;
        }
        // =================================================================
        // END FIELD VALIDATION
        // =================================================================

        // ---- Resolve Block (accepts UUID or name) ----
        if (typeof body.block === "string" && body.block.trim() !== "") {
          const blockInput = body.block.trim();

          if (isUuid(blockInput)) {
            const { data: blockData, error: blockErr } = await supabaseAdmin
              .from("SSP_Block")
              .select("block_id")
              .eq("society", societyContext.society_id)
              .eq("block_id", blockInput)
              .maybeSingle();

            if (blockErr) {
              throw new Error(`Block lookup failed: ${blockErr.message}`);
            }
            if (!blockData) {
              return errorResponse(
                `Block with id '${blockInput}' not found in this society.`,
                404,
              );
            }
            userUpdates.block = blockData.block_id;
          } else {
            const { data: blockData, error: blockErr } = await supabaseAdmin
              .from("SSP_Block")
              .select("block_id")
              .eq("society", societyContext.society_id)
              .eq("block_name", blockInput)
              .limit(1);

            if (blockErr) {
              throw new Error(`Block lookup failed: ${blockErr.message}`);
            }
            if (!blockData || blockData.length === 0) {
              return errorResponse(
                `Block '${blockInput}' not found in this society.`,
                404,
              );
            }
            userUpdates.block = blockData[0].block_id;
          }
        }

        // ---- Resolve Tower (accepts UUID or name) ----
        if (typeof body.tower === "string" && body.tower.trim() !== "") {
          const towerInput = body.tower.trim();

          if (isUuid(towerInput)) {
            const { data: towerData, error: towerErr } = await supabaseAdmin
              .from("SSP_Tower")
              .select("tower_id")
              .eq("society", societyContext.society_id)
              .eq("tower_id", towerInput)
              .maybeSingle();

            if (towerErr) {
              throw new Error(`Tower lookup failed: ${towerErr.message}`);
            }
            if (!towerData) {
              return errorResponse(
                `Tower with id '${towerInput}' not found in this society.`,
                404,
              );
            }
            userUpdates.tower = towerData.tower_id;
          } else {
            const { data: towerData, error: towerErr } = await supabaseAdmin
              .from("SSP_Tower")
              .select("tower_id")
              .eq("society", societyContext.society_id)
              .eq("name", towerInput)
              .limit(1);

            if (towerErr) {
              throw new Error(`Tower lookup failed: ${towerErr.message}`);
            }
            if (!towerData || towerData.length === 0) {
              return errorResponse(
                `Tower '${towerInput}' not found in this society.`,
                404,
              );
            }
            userUpdates.tower = towerData[0].tower_id;
          }
        }

        // ---- Extract contact_id ----
        let targetContactId: string | null = null;
        if (Array.isArray(su.contact)) {
          targetContactId = su.contact[0]?.contact_id ?? null;
        } else if (su.contact && typeof su.contact === "object") {
          targetContactId = su.contact.contact_id ?? null;
        }

        if (
          Object.keys(contactUpdates).length === 0 &&
          Object.keys(userUpdates).length === 0
        ) {
          return errorResponse(
            "No updatable fields provided. Nothing to update.",
            400,
          );
        }

        // ---- Apply updates with rollback ----
        let contactUpdated = false;
        const previousContactData: Record<string, unknown> = {};

        if (Object.keys(contactUpdates).length > 0 && targetContactId) {
          const { data: prev } = await supabaseAdmin
            .from("SSP_Contact")
            .select(Object.keys(contactUpdates).join(","))
            .eq("contact_id", targetContactId)
            .maybeSingle();
          if (prev) {
            for (const k of Object.keys(contactUpdates)) {
              // deno-lint-ignore no-explicit-any
              previousContactData[k] = (prev as any)[k];
            }
          }

          const { error: conUpdateErr } = await supabaseAdmin
            .from("SSP_Contact")
            .update(contactUpdates)
            .eq("contact_id", targetContactId);

          if (conUpdateErr) {
            throw new Error(
              `SSP_Contact mutation failed: ${conUpdateErr.message}`,
            );
          }
          contactUpdated = true;
        }

        if (Object.keys(userUpdates).length > 0) {
          const { error: userUpdateErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .update(userUpdates)
            .eq("user_id", su.user_id);

          if (userUpdateErr) {
            if (contactUpdated && targetContactId) {
              await supabaseAdmin
                .from("SSP_Contact")
                .update(previousContactData)
                .eq("contact_id", targetContactId);
              logger.warn({
                level: "warn",
                timestamp: new Date().toISOString(),
                action: "resident_profile_console_update_rollback",
                message:
                  "Rolled back SSP_Contact after SSP_Society_User failure",
              });
            }
            throw new Error(
              `SSP_Society_User mutation failed: ${userUpdateErr.message}`,
            );
          }
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_profile_console_update_end",
          userId,
          recordId: su.user_id,
          contactId: targetContactId,
          contactFields: Object.keys(contactUpdates).length,
          userFields: Object.keys(userUpdates).length,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            profileUpdate: {
              updated:
                `Profile for identifier '${cleanResidentId}' updated successfully.`,
              recordId: su.user_id,
              contactId: targetContactId,
            },
          }),
        );
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;

      // FieldValidationError (thrown outside the inner try/catch, e.g. by
      // assertStaffOnlyFieldsAllowed edge cases) → 400
      if (err.name === "FieldValidationError") {
        return errorResponse(err.message, 400);
      }

      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "resident_profile_console_error",
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime,
        message: "Resident profile console request failed",
      });

      return errorResponse(
        err.message || "Failed to process resident profile request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);