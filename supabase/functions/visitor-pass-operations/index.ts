import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const BUCKET_NAME = "society-documents";
const baseLogger = createLogger("security-unified-console");

const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({ level: "info", timestamp: new Date().toISOString(), ...data }),
  error: (data: Record<string, unknown>) =>
    baseLogger.error({ level: "error", timestamp: new Date().toISOString(), ...data }),
};

// ============================================
// HELPERS
// ============================================

function normalizeVisitorRole(raw: unknown): "visitor" | "vendor" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "vendor") return "vendor";
  return "visitor";
}

function nullIfBlank(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function safeSlug(s: string): string {
  return String(s).trim().replace(/[^\w\-]/g, "").slice(0, 64);
}

function parsePostgresArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim());
  const s = String(v).trim();
  if (s.startsWith("{") && s.endsWith("}")) {
    return s
      .slice(1, -1)
      .split(",")
      .map((x) => x.replace(/"/g, "").trim());
  }
  return [s];
}

// ============================================
// TYPES & INTERFACES
// ============================================
interface UnifiedSecurityPayload {
  actionType?:
    | "FETCH_PRE_APPROVALS"
    | "REQUEST_APPROVAL"
    | "UPDATE_STATUS"
    | "FETCH_INSIDE_LOGS"
    | "FETCH_RESIDENTS_BY_FLAT"
    | "FETCH_SERVANTS_BY_FLAT"
    | "UPDATE_SERVANT_STATUS";
  operation?: "UPLOAD" | "CONFIRM_UPLOAD" | "FETCH" | "FETCH_ALL";

  societyRegistrationNumber?: string;
  societyServantId?: string;          // ← ADDED — used by UPDATE_SERVANT_STATUS
  visitorId?: string;
  page?: number | string;
  limit?: number | string;
  searchTerm?: string;
  startDate?: string;
  endDate?: string;

  societyUserId?: string;
  securityGuardId?: string;
  flatNumber?: string;
  block?: string;
  tower?: string;
  newStatus?: string;
  visitorName?: string;
  phone?: string;
  email?: string;
  gender?: string;
  role?: string;
  idProofType?: string;
  idProofNumber?: string;
  gateNumber?: string;
  platform?: string;
  vehicleNumber?: string;
  vehicleType?: string;
  purpose?: string;

  fileName?: string;
  fileType?: string;
  fileSize?: string | number;
  fileBase64?: string;
  objectKey?: string;
  documentId?: string;
}

interface VisitorRow {
  non_society_user_id: string;
  name?: string | null;
  phone_number?: string | null;
  delivery_origin?: string | null;
  purpose?: string | null;
  vehicle_number?: string | null;
  visitor_status?: string | null;
  visitor_approval_status?: string | null;
  pre_approved?: boolean | null;
  check_in?: string | null;
  check_out?: string | null;
  created_at?: string | null;
  hosted_by?: {
    user_id?: string;
    unit_flat_number?: string | null;
    block?: { block_name?: string | null } | null;
    tower?: { name?: string | null } | null;
    contact?: { name?: string | null } | null;
  } | null;
}

interface DocumentRow {
  non_society_user?: string | null;
  s3_path?: string | null;
}

interface DocumentListRow {
  document_id: string | number;
  name?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  document_type?: string | null;
  s3_path?: string | null;
  uploaded_on?: string | null;
  non_society_user?: string | null;
}

interface ProcessedVisitor {
  visitorId: string;
  name: string;
  phone: string;
  platform: string;
  purpose: string;
  vehicle: string;
  status: string;
  approvalStatus: string | null;
  preApproved: boolean;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string | null;
  flat: string;
  block: string;
  tower: string;
  residentName: string;
  imageUrl: string | null;
}

interface ProcessedDocument {
  documentId: string | number;
  name: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  uploadedOn: string | null;
  visitorId: string | null;
  fileUrl: string | null;
  blobExists: boolean;
}

interface ResidentByFlat {
  phoneNumber: string;
  name: string;
  flatNumber: string;
  blockName: string;
  towerNumber: string;
  societyUserId: string;
}

interface ServantByFlat {
  societyServantId: string;
  servantId: string;
  servantName: string;
  phoneNumber: string;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  idProofType: string | null;
  idProofNumber: string | null;
  role: string[];
  shiftTiming: string[];
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  isRecurring: boolean;
  recurringDays: string[];
  hiredRoles: string[];
  hired: boolean;
  status: string | null;
  createdAt: string | null;
}

// ============================================
// INITIALIZATION
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtx: AuthContext): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      logger.info({
        action: "security_unified_console_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Security unified console request initialized",
      });

      if (req.method !== "POST") return errorResponse("Only POST method is allowed.", 405);

      const bodyText = await req.text().catch(() => null);
      if (!bodyText || bodyText.trim() === "")
        return errorResponse("Request body is empty.", 400);

      let requestObj: UnifiedSecurityPayload;
      try {
        requestObj = JSON.parse(bodyText) as UnifiedSecurityPayload;
      } catch {
        return errorResponse("Malformed JSON body.", 400);
      }

      const {
        actionType,
        operation,
        page = 1,
        limit = 10,
        societyRegistrationNumber,
        visitorId,
        searchTerm,
        startDate,
        endDate,
      } = requestObj;

      const currentAction = (actionType || operation)?.toUpperCase()?.trim();
      if (!currentAction)
        return errorResponse("actionType or operation parameter is mandatory.", 400);

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
      const offset = (pageNum - 1) * limitNum;

      // =========================================================================
      // ROUTING GROUP A: GATE CONSOLE OPERATIONS
      // =========================================================================
      if (
        [
          "FETCH_PRE_APPROVALS",
          "REQUEST_APPROVAL",
          "UPDATE_STATUS",
          "FETCH_INSIDE_LOGS",
          "FETCH_RESIDENTS_BY_FLAT",
          "FETCH_SERVANTS_BY_FLAT",
          "UPDATE_SERVANT_STATUS",
        ].includes(currentAction)
      ) {
        if (!societyRegistrationNumber || societyRegistrationNumber.trim() === "")
          return errorResponse("societyRegistrationNumber is mandatory.", 400);

        const cleanRegNum = societyRegistrationNumber.trim();

        const { data: societyContext, error: socErr } = await supabaseAdmin
          .from("SSP_Society")
          .select("society_id")
          .eq("registration_number", cleanRegNum)
          .maybeSingle();

        if (socErr || !societyContext)
          return errorResponse("Target society environment reference not found.", 404);

        const societyId = societyContext.society_id;

        // --- BRANCH 1: FETCH_PRE_APPROVALS ---
        if (currentAction === "FETCH_PRE_APPROVALS") {
          const SELECT_COLUMNS = `
            non_society_user_id,
            name,
            delivery_origin,
            phone_number,
            vehicle_number,
            purpose,
            visitor_status,
            visitor_approval_status,
            pre_approved,
            check_in,
            check_out,
            created_at,
            hosted_by:SSP_Society_User!hosted_by(
              user_id,
              unit_flat_number,
              contact:SSP_Contact(
                name
              )
            )
          `;

          const buildBaseQuery = () => {
            let q = supabaseAdmin
              .from("SSP_Non_Society_User")
              .select(SELECT_COLUMNS, { count: "exact" })
              .eq("society", societyId)
              .or(
                "visitor_status.is.null,visitor_status.ilike.Pending,visitor_status.ilike.Approved"
              );

            if (requestObj.societyUserId) {
              q = q.eq("hosted_by.user_id", requestObj.societyUserId.trim());
            }

            if (searchTerm && searchTerm.trim() !== "") {
              const cleanSearch = searchTerm.trim();
              q = q.or(
                `name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`
              );
            }
            return q;
          };

          const {
            data: preApprovedRows,
            count: preApprovedCount,
            error: preApprovedErr,
          } = await buildBaseQuery()
            .eq("pre_approved", true)
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

          if (preApprovedErr) throw preApprovedErr;

          const {
            data: recentRows,
            count: recentCount,
            error: recentErr,
          } = await buildBaseQuery()
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

          if (recentErr) throw recentErr;

          const [processedPreApproved, processedRecent] = await Promise.all([
            preApprovedRows && preApprovedRows.length > 0
              ? attachSignedURLsToVisitors(
                  supabaseAdmin,
                  preApprovedRows as VisitorRow[],
                  cleanRegNum
                )
              : Promise.resolve([] as ProcessedVisitor[]),
            recentRows && recentRows.length > 0
              ? attachSignedURLsToVisitors(
                  supabaseAdmin,
                  recentRows as VisitorRow[],
                  cleanRegNum
                )
              : Promise.resolve([] as ProcessedVisitor[]),
          ]);

          const preApprovedTotal = preApprovedCount ?? 0;
          const recentTotal = recentCount ?? 0;

          logger.info({
            action: "fetch_pre_approvals_success",
            preApprovedCount: processedPreApproved.length,
            recentCount: processedRecent.length,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            preApprovedVisitors: processedPreApproved,
            preApprovedPagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords: preApprovedTotal,
              totalPages: Math.ceil(preApprovedTotal / limitNum),
            },
            recentVisitors: processedRecent,
            recentPagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords: recentTotal,
              totalPages: Math.ceil(recentTotal / limitNum),
            },
            Visitors: processedPreApproved,
            pagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords: preApprovedTotal,
              totalPages: Math.ceil(preApprovedTotal / limitNum),
            },
            visitorId: null,
            success: true,
          });
        }

        // --- BRANCH 2: REQUEST_APPROVAL ---
        else if (currentAction === "REQUEST_APPROVAL") {
          const hostedByUuid = nullIfBlank(requestObj.societyUserId);
          const approverUuid = nullIfBlank(requestObj.securityGuardId);

          if (hostedByUuid) {
            const { data: resident } = await supabaseAdmin
              .from("SSP_Society_User")
              .select("user_id")
              .eq("user_id", hostedByUuid)
              .eq("society", societyId)
              .maybeSingle();
            if (!resident) return errorResponse("Resident user not found.", 404);
          }

          if (approverUuid) {
            const { data: security } = await supabaseAdmin
              .from("SSP_Society_User")
              .select("user_id")
              .eq("user_id", approverUuid)
              .eq("society", societyId)
              .maybeSingle();
            if (!security) return errorResponse("Security Guard not found.", 404);
          }

          const normalizedRole = normalizeVisitorRole(requestObj.role);

          const { data: newVisitor, error: insertErr } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .insert({
              name: nullIfBlank(requestObj.visitorName) ?? "Unknown",
              phone_number: nullIfBlank(requestObj.phone),
              delivery_origin: nullIfBlank(requestObj.platform),
              vehicle_number: nullIfBlank(requestObj.vehicleNumber),
              purpose: nullIfBlank(requestObj.purpose),
              role: normalizedRole,
              gender: nullIfBlank(requestObj.gender),
              email: nullIfBlank(requestObj.email),
              id_proof_type: nullIfBlank(requestObj.idProofType),
              id_proof_number: nullIfBlank(requestObj.idProofNumber),
              gate_no: nullIfBlank(requestObj.gateNumber),
              vehicle_type: nullIfBlank(requestObj.vehicleType),
              visitor_status: "Pending",
              pre_approved: false,
              check_in: null,
              check_out: null,
              hosted_by: hostedByUuid,
              approver: approverUuid,
              society: societyId,
            })
            .select(
              `
              non_society_user_id,
              name,
              delivery_origin,
              phone_number,
              vehicle_number,
              purpose,
              visitor_status,
              visitor_approval_status,
              pre_approved,
              check_in,
              check_out,
              created_at,
              hosted_by:SSP_Society_User!hosted_by(
                user_id,
                unit_flat_number,
                block:SSP_Block(
                  block_name
                ),
                tower:SSP_Tower(
                  name
                ),
                contact:SSP_Contact(
                  name
                )
              )
            `
            )
            .single();

          if (insertErr || !newVisitor) {
            console.error("❌ Request approval insert failed:", insertErr);

            const msg = String(insertErr?.message ?? "");
            if (msg.includes("chk_non_society_user_role")) {
              return errorResponse(
                `Role '${requestObj.role}' is not allowed. Allowed values: visitor, vendor.`,
                400
              );
            }
            if (msg.includes("violates not-null constraint")) {
              return errorResponse(
                "A required field is missing. Check that name, phone, and role are provided.",
                400
              );
            }
            throw insertErr ?? new Error("Failed to create visitor record.");
          }

          const [processed] = await attachSignedURLsToVisitors(
            supabaseAdmin,
            [newVisitor as VisitorRow],
            cleanRegNum
          );

          logger.info({
            action: "request_approval_success",
            visitorId: newVisitor.non_society_user_id,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            visitor: processed,
            visitorId: newVisitor.non_society_user_id,
            success: true,
          });
        }

        // --- BRANCH 3: UPDATE_STATUS ---
        else if (currentAction === "UPDATE_STATUS") {
          if (!visitorId)
            return errorResponse("visitorId parameter missing from update routing request.", 400);

          const { data: checkVisitor } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .select("non_society_user_id")
            .eq("non_society_user_id", visitorId)
            .eq("society", societyId)
            .maybeSingle();

          if (!checkVisitor)
            return errorResponse(`No visitor found with ID: ${visitorId}`, 404);

          const updatePayload: Record<string, unknown> = {};
          const targetStatus = String(requestObj.newStatus).trim().toLowerCase();

          if (targetStatus === "inside") {
            updatePayload.check_in = new Date().toISOString();
            updatePayload.check_out = null;
            updatePayload.visitor_status = "Inside";
          } else if (targetStatus === "outside") {
            updatePayload.check_out = new Date().toISOString();
            updatePayload.visitor_status = "Outside";
          } else if (targetStatus === "approved") {
            updatePayload.visitor_status = "Approved";
            updatePayload.pre_approved = true;
          } else if (targetStatus === "rejected") {
            updatePayload.visitor_status = "Rejected";
            updatePayload.pre_approved = false;
          } else {
            return errorResponse(
              "Invalid status provided. Expected 'Approved', 'Rejected', 'Inside', or 'Outside'.",
              400
            );
          }

          const { error: updateErr } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .update(updatePayload)
            .eq("non_society_user_id", visitorId);

          if (updateErr) throw updateErr;

          logger.info({
            action: "update_status_success",
            visitorId,
            status: updatePayload.visitor_status,
            durationMs: Date.now() - startTime,
          });

          return successResponse({ Visitors: [], visitorId, success: true });
        }

        // --- BRANCH 4: FETCH_INSIDE_LOGS ---
        else if (currentAction === "FETCH_INSIDE_LOGS") {
          let query = supabaseAdmin
            .from("SSP_Non_Society_User")
            .select(
              `
              non_society_user_id,
              name,
              delivery_origin,
              phone_number,
              vehicle_number,
              purpose,
              visitor_status,
              visitor_approval_status,
              pre_approved,
              check_in,
              check_out,
              created_at,
              hosted_by:SSP_Society_User!hosted_by(
                user_id,
                unit_flat_number,
                block:SSP_Block(
                  block_name
                ),
                tower:SSP_Tower(
                  name
                ),
                contact:SSP_Contact(
                  name
                )
              )
            `,
              { count: "exact" }
            )
            .eq("society", societyId);

          if (requestObj.newStatus && requestObj.newStatus.trim() !== "") {
            query = query.ilike("visitor_status", requestObj.newStatus.trim());
          } else {
            query = query.ilike("visitor_status", "Inside");
          }

          const cleanFlat = requestObj.flatNumber ? String(requestObj.flatNumber).trim() : "";
          const cleanBlock = requestObj.block ? String(requestObj.block).trim() : "";
          const cleanTower = requestObj.tower ? String(requestObj.tower).trim() : "";

          if (cleanFlat !== "") query = query.eq("hosted_by.unit_flat_number", cleanFlat);
          if (cleanBlock !== "") query = query.eq("hosted_by.block.block_name", cleanBlock);
          if (cleanTower !== "") query = query.eq("hosted_by.tower.name", cleanTower);

          if (searchTerm && searchTerm.trim() !== "") {
            const cleanSearch = searchTerm.trim();
            query = query.or(
              `name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`
            );
          }

          if (startDate) query = query.gte("created_at", new Date(startDate).toISOString());
          if (endDate) query = query.lte("created_at", new Date(endDate).toISOString());

          if (
            !cleanFlat &&
            !cleanBlock &&
            !cleanTower &&
            !startDate &&
            !endDate &&
            (!requestObj.newStatus || requestObj.newStatus.toLowerCase() === "inside")
          ) {
            const todayStart = new Date();
            todayStart.setUTCHours(0, 0, 0, 0);
            query = query.gte("check_in", todayStart.toISOString());
          }

          const { data: insideVisitors, count, error: logErr } = await query
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

          if (logErr) throw logErr;

          let processedVisitors: ProcessedVisitor[] = [];
          if (insideVisitors && insideVisitors.length > 0) {
            processedVisitors = await attachSignedURLsToVisitors(
              supabaseAdmin,
              insideVisitors as VisitorRow[],
              cleanRegNum
            );
          }

          const totalRecords = count ?? 0;

          logger.info({
            action: "fetch_inside_logs_success",
            count: processedVisitors.length,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            Visitors: processedVisitors,
            pagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords,
              totalPages: Math.ceil(totalRecords / limitNum),
            },
            visitorId: null,
            success: true,
          });
        }

        // --- BRANCH 5: FETCH_RESIDENTS_BY_FLAT ---
        else if (currentAction === "FETCH_RESIDENTS_BY_FLAT") {
          const cleanFlat = requestObj.flatNumber
            ? String(requestObj.flatNumber).trim()
            : "";

          if (cleanFlat === "") {
            return errorResponse(
              "flatNumber is required for FETCH_RESIDENTS_BY_FLAT.",
              400
            );
          }

          const cleanBlock = requestObj.block ? String(requestObj.block).trim() : "";
          const cleanTower = requestObj.tower ? String(requestObj.tower).trim() : "";

          let resQuery = supabaseAdmin
            .from("SSP_Society_User")
            .select(
              `
              user_id,
              unit_flat_number,
              block:SSP_Block ( block_name ),
              tower:SSP_Tower ( name ),
              contact:SSP_Contact ( name, phone )
            `,
              { count: "exact" }
            )
            .eq("society", societyId)
            .eq("unit_flat_number", cleanFlat)
            .eq("user_ownership_type", "primary");

          if (cleanBlock !== "") {
            resQuery = resQuery.eq("block.block_name", cleanBlock);
          }
          if (cleanTower !== "") {
            resQuery = resQuery.eq("tower.name", cleanTower);
          }

          const {
            data: residentRows,
            count: residentCount,
            error: residentErr,
          } = await resQuery
            .order("created_at", { ascending: true })
            .range(offset, offset + limitNum - 1);

          if (residentErr) {
            throw new Error(
              `Failed fetching residents for flat: ${residentErr.message}`
            );
          }

          const residents: ResidentByFlat[] = (residentRows ?? []).map(
            (row: Record<string, unknown>) => {
              const rawContact = Array.isArray(row.contact)
                ? (row.contact[0] as Record<string, unknown> | undefined)
                : (row.contact as Record<string, unknown> | undefined);
              const rawBlock = Array.isArray(row.block)
                ? (row.block[0] as Record<string, unknown> | undefined)
                : (row.block as Record<string, unknown> | undefined);
              const rawTower = Array.isArray(row.tower)
                ? (row.tower[0] as Record<string, unknown> | undefined)
                : (row.tower as Record<string, unknown> | undefined);

              return {
                phoneNumber: String(rawContact?.phone ?? ""),
                name: String(rawContact?.name ?? ""),
                flatNumber: String(row.unit_flat_number ?? cleanFlat),
                blockName: String(rawBlock?.block_name ?? ""),
                towerNumber: String(rawTower?.name ?? ""),
                societyUserId: String(row.user_id ?? ""),
              };
            }
          );

          const totalRecords = residentCount ?? residents.length;

          logger.info({
            action: "fetch_residents_by_flat_success",
            flatNumber: cleanFlat,
            count: residents.length,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            residents,
            flatNumber: cleanFlat,
            pagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords,
              totalPages: Math.ceil(totalRecords / limitNum),
            },
            success: true,
          });
        }

        // --- BRANCH 6: FETCH_SERVANTS_BY_FLAT ---
        else if (currentAction === "FETCH_SERVANTS_BY_FLAT") {
          const cleanFlat = requestObj.flatNumber
            ? String(requestObj.flatNumber).trim()
            : "";

          if (cleanFlat === "") {
            return errorResponse(
              "flatNumber is required for FETCH_SERVANTS_BY_FLAT.",
              400
            );
          }

          const { data: flatUsers, error: flatUsersErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id")
            .eq("society", societyId)
            .eq("unit_flat_number", cleanFlat);

          if (flatUsersErr) {
            throw new Error(
              `Failed to fetch residents for flat: ${flatUsersErr.message}`
            );
          }

          const residentIds = (flatUsers ?? []).map(
            (r: Record<string, unknown>) => String(r.user_id ?? "")
          ).filter((id) => id !== "");

          logger.info({
            action: "fetch_servants_by_flat_residents",
            flatNumber: cleanFlat,
            residentCount: residentIds.length,
          });

          if (residentIds.length === 0) {
            return successResponse({
              flatNumber: cleanFlat,
              totalServants: 0,
              servants: [],
              success: true,
            });
          }

          const { data: servantLinks, error: linksErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .select(
              `
              society_servant_id,
              hired,
              is_recurring,
              recurring_days,
              status,
              hired_roles,
              created_at,
              society_user,
              servant:SSP_Servant!fk_ss_servant (
                servant_id,
                servant_name,
                phone_number,
                gender,
                date_of_birth,
                address,
                id_proof_type,
                id_proof_number,
                role,
                shift_timing,
                scheduled_arrival,
                scheduled_departure,
                is_recurring,
                status,
                deleted_at
              )
            `
            )
            .in("society_user", residentIds)
            .order("created_at", { ascending: false });

          if (linksErr) {
            throw new Error(
              `Failed to fetch servants for flat: ${linksErr.message}`
            );
          }

          const servants: ServantByFlat[] = (servantLinks ?? [])
            .map((link: Record<string, unknown>): ServantByFlat | null => {
              const rawServant = Array.isArray(link.servant)
                ? (link.servant[0] as Record<string, unknown> | undefined)
                : (link.servant as Record<string, unknown> | undefined);
              if (!rawServant) return null;

              if (rawServant.deleted_at) return null;

              return {
                societyServantId: String(link.society_servant_id ?? ""),
                servantId: String(rawServant.servant_id ?? ""),
                servantName: String(rawServant.servant_name ?? ""),
                phoneNumber: String(rawServant.phone_number ?? ""),
                gender: rawServant.gender ? String(rawServant.gender) : null,
                dateOfBirth: rawServant.date_of_birth
                  ? String(rawServant.date_of_birth)
                  : null,
                address: rawServant.address ? String(rawServant.address) : null,
                idProofType: rawServant.id_proof_type
                  ? String(rawServant.id_proof_type)
                  : null,
                idProofNumber: rawServant.id_proof_number
                  ? String(rawServant.id_proof_number)
                  : null,
                role: parsePostgresArray(rawServant.role),
                shiftTiming: parsePostgresArray(rawServant.shift_timing),
                scheduledArrival: rawServant.scheduled_arrival
                  ? String(rawServant.scheduled_arrival)
                  : null,
                scheduledDeparture: rawServant.scheduled_departure
                  ? String(rawServant.scheduled_departure)
                  : null,
                isRecurring: Boolean(
                  link.is_recurring ?? rawServant.is_recurring ?? false
                ),
                recurringDays: parsePostgresArray(link.recurring_days),
                hiredRoles: parsePostgresArray(link.hired_roles),
                hired: Boolean(link.hired),
                status: link.status
                  ? String(link.status)
                  : rawServant.status
                  ? String(rawServant.status)
                  : null,
                createdAt: link.created_at ? String(link.created_at) : null,
              };
            })
            .filter((s): s is ServantByFlat => s !== null);

          logger.info({
            action: "fetch_servants_by_flat_success",
            flatNumber: cleanFlat,
            count: servants.length,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            flatNumber: cleanFlat,
            totalServants: servants.length,
            servants,
            success: true,
          });
        }

        // --- BRANCH 7: UPDATE_SERVANT_STATUS ---
        else if (currentAction === "UPDATE_SERVANT_STATUS") {
          const societyServantId = nullIfBlank(requestObj.societyServantId);
          if (!societyServantId) {
            return errorResponse(
              "societyServantId is required for UPDATE_SERVANT_STATUS.",
              400
            );
          }

          const rawStatus = String(requestObj.newStatus ?? "").trim();
          if (rawStatus === "") {
            return errorResponse(
              "newStatus is required for UPDATE_SERVANT_STATUS.",
              400
            );
          }

          // Normalize to the DB check constraint's allowed values.
          const statusMap: Record<
            string,
            "Inside" | "Outside" | "Active" | "Inactive"
          > = {
            inside: "Inside",
            outside: "Outside",
            active: "Active",
            inactive: "Inactive",
          };
          const normalizedStatus = statusMap[rawStatus.toLowerCase()];
          if (!normalizedStatus) {
            return errorResponse(
              "Invalid newStatus. Expected one of: Inside, Outside, Active, Inactive.",
              400
            );
          }

          // Verify the link exists AND belongs to this society
          const { data: linkRow, error: linkErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .select(
              `
              society_servant_id,
              society_user,
              servant_id,
              status,
              society_user_ref:SSP_Society_User!fk_ss_society_user (
                user_id,
                society
              )
            `
            )
            .eq("society_servant_id", societyServantId)
            .maybeSingle();

          if (linkErr) {
            throw new Error(
              `Servant link lookup failed: ${linkErr.message}`
            );
          }
          if (!linkRow) {
            return errorResponse(
              `No servant link found with ID: ${societyServantId}`,
              404
            );
          }

          // Scope check — the joined society user must belong to this society
          const rawUserRef = (linkRow as Record<string, unknown>)
            .society_user_ref;
          const userRef = Array.isArray(rawUserRef)
            ? (rawUserRef[0] as Record<string, unknown> | undefined)
            : (rawUserRef as Record<string, unknown> | undefined);

          const linkSocietyId = userRef?.society as string | undefined;
          if (!linkSocietyId || linkSocietyId !== societyId) {
            return errorResponse(
              "This servant link does not belong to the target society.",
              403
            );
          }

          const previousStatus = linkRow.status ?? null;

          const { error: updateErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .update({ status: normalizedStatus })
            .eq("society_servant_id", societyServantId);

          if (updateErr) {
            throw new Error(
              `Failed to update servant status: ${updateErr.message}`
            );
          }

          logger.info({
            action: "update_servant_status_success",
            societyServantId,
            previousStatus,
            newStatus: normalizedStatus,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            societyServantId,
            previousStatus,
            newStatus: normalizedStatus,
            success: true,
          });
        }
      }

      // =========================================================================
      // ROUTING GROUP B: SECURITY GUARD IMAGE OPERATIONS
      // =========================================================================
      else if (["UPLOAD", "CONFIRM_UPLOAD", "FETCH", "FETCH_ALL"].includes(currentAction)) {
        // --- BRANCH 8: UPLOAD (two-phase) ---
        if (currentAction === "UPLOAD") {
          if (
            !societyRegistrationNumber ||
            !requestObj.fileName ||
            !requestObj.fileType ||
            !visitorId
          ) {
            return errorResponse(
              "Missing required fields: societyRegistrationNumber, visitorId, fileName, and fileType are mandatory.",
              400
            );
          }

          const cleanRegNum = societyRegistrationNumber.trim();
          const folderSlug = safeSlug(cleanRegNum);
          const cleanVisitorId = visitorId.trim();

          const { data: nonSocietyUser, error: nsuErr } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .select("non_society_user_id")
            .eq("non_society_user_id", cleanVisitorId)
            .maybeSingle();

          if (nsuErr || !nonSocietyUser)
            return errorResponse("Visitor profile entry not found.", 404);

          const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNum)
            .maybeSingle();

          if (socErr || !society)
            return errorResponse("Target society context not found.", 404);

          const cleanFileName = requestObj.fileName.trim().replace(/\s+/g, "_");
          const uniqueFileName = `${Date.now()}_${cleanFileName}`;
          const objectKey = `${folderSlug}/securityGuard/${uniqueFileName}`;

          // PATH A: base64 provided → upload server-side, then INSERT
          if (requestObj.fileBase64) {
            const raw = requestObj.fileBase64;
            const base64Data = raw.includes(",") ? raw.split(",")[1] : raw;

            let bytes: Uint8Array;
            try {
              const bin = atob(base64Data);
              bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            } catch {
              return errorResponse("Invalid base64 payload in 'fileBase64'.", 400);
            }

            const { data: uploadRes, error: uploadErr } = await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .upload(objectKey, bytes, {
                contentType: requestObj.fileType,
                upsert: false,
              });

            if (uploadErr || !uploadRes) {
              console.error("❌ Storage upload failed:", uploadErr);
              return errorResponse(
                `Storage upload failed: ${uploadErr?.message ?? "unknown error"}`,
                500
              );
            }

            const { data: urlInfo } = supabaseAdmin.storage
              .from(BUCKET_NAME)
              .getPublicUrl(objectKey);

            const { data: newDoc, error: insertErr } = await supabaseAdmin
              .from("SSP_Document")
              .insert({
                name: requestObj.fileName,
                file_name: uniqueFileName,
                file_type: requestObj.fileType,
                file_size: requestObj.fileSize
                  ? parseFloat(String(requestObj.fileSize))
                  : bytes.byteLength,
                document_type: "Security Guard Image",
                s3_path: urlInfo.publicUrl,
                society: society.society_id,
                non_society_user: nonSocietyUser.non_society_user_id,
                uploaded_on: new Date().toISOString(),
              })
              .select("document_id")
              .single();

            if (insertErr || !newDoc) {
              await supabaseAdmin.storage.from(BUCKET_NAME).remove([objectKey]);
              return errorResponse(
                `Failed saving document metadata: ${insertErr?.message}`,
                500
              );
            }

            const { data: signedView } = await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .createSignedUrl(objectKey, 900);

            logger.info({
              action: "upload_security_guard_image_success",
              mode: "base64",
              documentId: newDoc.document_id,
              visitorId: cleanVisitorId,
              durationMs: Date.now() - startTime,
            });

            return successResponse({
              uploaded: true,
              documentId: newDoc.document_id,
              objectKey,
              fileUrl: signedView?.signedUrl ?? null,
              message: "File uploaded and record created.",
            });
          }

          // PATH B: no base64 → return signed UPLOAD URL, NO DB INSERT
          const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey, { upsert: false });

          if (signErr || !signed) {
            return errorResponse(
              `Failed generating upload URL: ${signErr?.message}`,
              500
            );
          }

          logger.info({
            action: "upload_url_generated",
            mode: "signed_url",
            objectKey,
            visitorId: cleanVisitorId,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            uploaded: false,
            documentId: null,
            objectKey,
            uploadUrl: signed.signedUrl,
            fileUrl: null,
            message:
              "PUT the binary to `uploadUrl`, then call operation=CONFIRM_UPLOAD with the same objectKey to create the record.",
          });
        }

        // --- BRANCH 9: CONFIRM_UPLOAD ---
        else if (currentAction === "CONFIRM_UPLOAD") {
          if (
            !societyRegistrationNumber ||
            !requestObj.objectKey ||
            !visitorId ||
            !requestObj.fileName ||
            !requestObj.fileType
          ) {
            return errorResponse(
              "societyRegistrationNumber, visitorId, fileName, fileType, and objectKey are mandatory for CONFIRM_UPLOAD.",
              400
            );
          }

          const cleanRegNum = societyRegistrationNumber.trim();
          const folderSlug = safeSlug(cleanRegNum);
          const cleanVisitorId = visitorId.trim();
          const objectKey = requestObj.objectKey.trim();

          if (!objectKey.startsWith(`${folderSlug}/securityGuard/`)) {
            return errorResponse(
              "objectKey does not belong to this society's securityGuard folder.",
              400
            );
          }

          const { data: nonSocietyUser, error: nsuErr } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .select("non_society_user_id")
            .eq("non_society_user_id", cleanVisitorId)
            .maybeSingle();

          if (nsuErr || !nonSocietyUser)
            return errorResponse("Visitor profile entry not found.", 404);

          const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNum)
            .maybeSingle();

          if (socErr || !society)
            return errorResponse("Target society context not found.", 404);

          const lastSlash = objectKey.lastIndexOf("/");
          const dir = objectKey.substring(0, lastSlash);
          const nameOnly = objectKey.substring(lastSlash + 1);

          const { data: listed, error: listErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .list(dir, { search: nameOnly, limit: 1 });

          if (listErr || !listed || listed.length === 0) {
            return errorResponse(
              "Uploaded object not found in storage. Please PUT the file to the uploadUrl first.",
              404
            );
          }

          const { data: urlInfo } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(objectKey);

          const { data: signedView } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(objectKey, 900);

          const { data: newDoc, error: insertErr } = await supabaseAdmin
            .from("SSP_Document")
            .insert({
              name: requestObj.fileName,
              file_name: nameOnly,
              file_type: requestObj.fileType,
              file_size: requestObj.fileSize
                ? parseFloat(String(requestObj.fileSize))
                : null,
              document_type: "Security Guard Image",
              s3_path: urlInfo.publicUrl,
              society: society.society_id,
              non_society_user: nonSocietyUser.non_society_user_id,
              uploaded_on: new Date().toISOString(),
            })
            .select("document_id")
            .single();

          if (insertErr || !newDoc) {
            return errorResponse(
              `Failed saving document metadata: ${insertErr?.message}`,
              500
            );
          }

          logger.info({
            action: "confirm_upload_success",
            documentId: newDoc.document_id,
            visitorId: cleanVisitorId,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            uploaded: true,
            documentId: newDoc.document_id,
            objectKey,
            fileUrl: signedView?.signedUrl ?? null,
          });
        }

        // --- BRANCH 10: FETCH (Single) ---
        else if (currentAction === "FETCH") {
          if (!requestObj.documentId)
            return errorResponse("documentId parameter is required for FETCH operation.", 400);

          const { data: doc, error: fetchErr } = await supabaseAdmin
            .from("SSP_Document")
            .select("document_id, s3_path")
            .eq("document_id", requestObj.documentId.trim())
            .maybeSingle();

          if (fetchErr || !doc || !doc.s3_path)
            return errorResponse("Document record or storage reference not found.", 404);

          let viewUrl: string | null = null;
          const computedKey = extractStorageKey(doc.s3_path);

          if (computedKey) {
            const { data: signedData } = await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .createSignedUrl(computedKey, 900);

            if (signedData) viewUrl = signedData.signedUrl;
          }

          logger.info({
            action: "fetch_security_guard_image_success",
            documentId: requestObj.documentId,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            uploaded: null,
            fileUrl: viewUrl,
            documentId: doc.document_id,
            blobExists: viewUrl !== null,
          });
        }

        // --- BRANCH 11: FETCH_ALL (List) ---
        else if (currentAction === "FETCH_ALL") {
          let query = supabaseAdmin
            .from("SSP_Document")
            .select(
              `
              document_id,
              name,
              file_name,
              file_type,
              file_size,
              document_type,
              s3_path,
              uploaded_on,
              non_society_user
            `,
              { count: "exact" }
            )
            .eq("document_type", "Security Guard Image");

          if (visitorId && visitorId.trim() !== "") {
            query = query.eq("non_society_user", visitorId.trim());
          }

          if (searchTerm && searchTerm.trim() !== "") {
            const cleanSearch = searchTerm.trim();
            query = query.or(
              `name.ilike.%${cleanSearch}%,file_name.ilike.%${cleanSearch}%`
            );
          }

          if (startDate) query = query.gte("uploaded_on", new Date(startDate).toISOString());
          if (endDate) query = query.lte("uploaded_on", new Date(endDate).toISOString());

          const { data: documents, count, error: fetchAllErr } = await query
            .order("uploaded_on", { ascending: false })
            .range(offset, offset + limitNum - 1);

          if (fetchAllErr)
            throw new Error(`Failed listing document records: ${fetchAllErr.message}`);

          const processedDocuments: ProcessedDocument[] = await Promise.all(
            ((documents ?? []) as DocumentListRow[]).map(async (doc) => {
              let signedUrl: string | null = null;
              const computedKey = extractStorageKey(doc.s3_path ?? "");

              if (computedKey) {
                const { data: signedData } = await supabaseAdmin.storage
                  .from(BUCKET_NAME)
                  .createSignedUrl(computedKey, 900);

                if (signedData) signedUrl = signedData.signedUrl;
              }

              return {
                documentId: doc.document_id,
                name: doc.name ?? null,
                fileName: doc.file_name ?? null,
                fileType: doc.file_type ?? null,
                fileSize: doc.file_size ?? null,
                uploadedOn: doc.uploaded_on ?? null,
                visitorId: doc.non_society_user ?? null,
                fileUrl: signedUrl,
                blobExists: signedUrl !== null,
              };
            })
          );

          const totalRecords = count ?? 0;

          logger.info({
            action: "fetch_all_security_guard_images_success",
            count: processedDocuments.length,
            durationMs: Date.now() - startTime,
          });

          return successResponse({
            documents: processedDocuments,
            pagination: {
              currentPage: pageNum,
              pageSize: limitNum,
              totalRecords,
              totalPages: Math.ceil(totalRecords / limitNum),
            },
          });
        }
      }

      return errorResponse("Invalid or unmapped actionType / operation.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "security_unified_console_error",
        error: err.message,
        durationMs: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Security unified console execution failed.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null
      );
    }
  })
);

// =============================================================================
// STORAGE RESOURCE HELPER UTILS
// =============================================================================
async function attachSignedURLsToVisitors(
  supabase: SupabaseClient,
  visitorList: VisitorRow[],
  registrationNumber: string
): Promise<ProcessedVisitor[]> {
  const visitorIds = visitorList.map((v) => v.non_society_user_id);

  const { data: docs } = await supabase
    .from("SSP_Document")
    .select("non_society_user, s3_path")
    .in("non_society_user", visitorIds);

  const imageMap = new Map<string, string>();

  (docs as DocumentRow[] | null)?.forEach((doc) => {
    if (doc.non_society_user && doc.s3_path) {
      imageMap.set(doc.non_society_user, doc.s3_path.trim());
    }
  });

  return await Promise.all(
    visitorList.map(async (v): Promise<ProcessedVisitor> => {
      let finalSignedUrl: string | null = null;
      const rawPath = imageMap.get(v.non_society_user_id);

      if (rawPath) {
        const storageKey = extractStorageKey(rawPath);
        if (storageKey) {
          const { data: signedPayload } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(storageKey, 900);

          if (signedPayload) finalSignedUrl = signedPayload.signedUrl;
        }
      }

      return {
        visitorId: v.non_society_user_id,
        name: v.name ?? "",
        phone: v.phone_number ?? "",
        platform: v.delivery_origin ?? "N/A",
        purpose: v.purpose ?? "N/A",
        vehicle: v.vehicle_number ?? "N/A",
        status: v.visitor_status ?? "",
        approvalStatus: v.visitor_approval_status ?? null,
        preApproved: Boolean(v.pre_approved),
        checkIn: v.check_in ?? null,
        checkOut: v.check_out ?? null,
        createdAt: v.created_at ?? null,
        flat: v.hosted_by?.unit_flat_number ?? "N/A",
        block: v.hosted_by?.block?.block_name ?? "N/A",
        tower: v.hosted_by?.tower?.name ?? "N/A",
        residentName: v.hosted_by?.contact?.name ?? "N/A",
        imageUrl: finalSignedUrl,
      };
    })
  );
}

/**
 * Robustly extract the storage object key from a Supabase public/signed URL,
 * an S3 URL, or a raw path.
 */
function extractStorageKey(fullUrl: string): string | null {
  if (!fullUrl) return null;
  const url = fullUrl.trim();

  if (url.includes(`/${BUCKET_NAME}/`)) {
    return url.split(`/${BUCKET_NAME}/`)[1].split("?")[0].trim();
  }
  if (url.includes(".amazonaws.com/")) {
    return url.split(".amazonaws.com/")[1].split("?")[0].trim();
  }
  return url.split("?")[0];
}