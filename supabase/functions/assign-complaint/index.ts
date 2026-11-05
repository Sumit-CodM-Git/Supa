import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface AssignComplaintRequest {
  societyRegistrationNumber: string;
  complaintId: string;
  staffId?: string;
}

interface AssignmentStatus {
  assigned: boolean;
  message: string;
}

interface AvailableStaff {
  id: string;
  name: string;
  phone: string | null;
  role: "vendor" | "service_agent";
  serviceType: string | null;
  rating: string | null;
}

interface ComplaintData {
  complaint_id: string;
  name: string;
  complaint_type: string;
  status: string;
  assigned_agent: string | null;
  non_society_user: string | null;
  society_user: string;
}

interface VendorData {
  non_society_user_id: string;
  name: string;
  role: string;
  service_type: string | null;
  phone_number: string | null;
  vendor_rating: string | null;
}

interface AgentContact {
  name: string;
  phone: string;
}

interface AgentData {
  user_id: string;
  role: string[];
  service_agent_services: string | null;
  agent_availability_status: string;
  service_agent_rating: number | null;
  contact: AgentContact | AgentContact[] | null;
}

interface RawAgentData {
  user_id: string;
  role: string[];
  service_agent_services: string | null;
  agent_availability_status: string;
  service_agent_rating: number | null;
  contact: AgentContact[] | null;
}

interface AssignResponse {
  assignmentStatus: AssignmentStatus;
  availableStaff: AvailableStaff[];
}

// ============================================
// CONSTANTS
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get IST ISO string
 */
function getISTISOString(): string {
  const now = new Date();
  const options = {
    timeZone: "Asia/Kolkata",
    year: "numeric" as const,
    month: "2-digit" as const,
    day: "2-digit" as const,
    hour: "2-digit" as const,
    minute: "2-digit" as const,
    second: "2-digit" as const,
    hour12: false as const,
  };
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  const parts = formatter.formatToParts(now);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${
    map.get("hour")
  }:${map.get("minute")}:${map.get("second")}+05:30`;
}

/**
 * Extract first item from array or return null
 */
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) {
    return arr.length > 0 ? arr[0] : null;
  }
  return arr;
}

/**
 * Parse service types from various formats
 */
function parseServiceTypes(serviceType: string | null): string[] {
  if (!serviceType) return [];

  const raw = String(serviceType).trim();

  if (raw.startsWith("[")) {
    try {
      const services = JSON.parse(raw);
      if (Array.isArray(services)) {
        return services.map((s: string) => String(s).trim().toLowerCase());
      }
      return [];
    } catch {
      return [];
    }
  }

  if (raw.includes(",")) {
    return raw.split(",").map((x) => x.trim().toLowerCase());
  }

  return [raw.toLowerCase()];
}

/**
 * Normalize complaint type for matching
 */
function normalizeComplaintType(type: string): string {
  const normalized = type.toLowerCase().trim();

  const mappings: { [key: string]: string } = {
    "electric": "electrical",
    "carpenter": "carpentry",
    "carpanter": "carpentry",
    "painter": "painting",
    "plumber": "plumbing",
    "housekeeping": "housekeeping",
    "maintenance": "maintenance",
    "security": "security",
    "other": "other",
  };

  return mappings[normalized] || normalized;
}

/**
 * Check if staff matches complaint type
 */
function matchesComplaintType(
  staffServices: string[],
  complaintType: string,
  isOtherComplaint: boolean,
): boolean {
  if (isOtherComplaint) {
    return staffServices.includes("other");
  }

  const normalizedComplaint = normalizeComplaintType(complaintType);

  return staffServices.some((service) => {
    const normalizedService = normalizeComplaintType(service);
    return normalizedService === normalizedComplaint;
  });
}

/**
 * Sort staff by role (Service Agents first) and then by rating (highest first)
 */
function sortStaff(staff: AvailableStaff[]): AvailableStaff[] {
  return [...staff].sort((a, b) => {
    // First, sort by role: Service Agents first
    if (a.role === "service_agent" && b.role === "vendor") return -1;
    if (a.role === "vendor" && b.role === "service_agent") return 1;

    // If same role, sort by rating (highest first)
    const ratingA = parseFloat(a.rating || "0");
    const ratingB = parseFloat(b.rating || "0");
    return ratingB - ratingA;
  });
}

/**
 * Assign staff to complaint
 */
async function assignStaffToRecord(
  complaintId: string,
  staffId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    // Check if staff is a Vendor
    const { data: vendorData, error: vendorError } = await supabaseAdmin
      .from("SSP_Non_Society_User")
      .select("non_society_user_id, role")
      .eq("non_society_user_id", staffId)
      .eq("role", "vendor")
      .maybeSingle();

    if (vendorError) {
      return { success: false, message: vendorError.message };
    }

    if (vendorData) {
      const { error: updateError } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
          non_society_user: staffId,
          assigned_agent: null,
          status: "Assigned",
          assigned_date_time: getISTISOString(),
        })
        .eq("complaint_id", complaintId);

      if (updateError) {
        return { success: false, message: updateError.message };
      }

      return { success: true, message: "Vendor assigned successfully" };
    }

    // Check if staff is a Service Agent
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from("SSP_Society_User")
      .select("user_id, role")
      .eq("user_id", staffId)
      .maybeSingle();

    if (agentError) {
      return { success: false, message: agentError.message };
    }

    if (agentData) {
      const roles = agentData.role ?? [];
      if (!roles.includes("service_agent")) {
        return {
          success: false,
          message: "Selected user is not a Service Agent.",
        };
      }

      const { error: updateError } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
          assigned_agent: staffId,
          non_society_user: null,
          status: "Assigned",
          assigned_date_time: getISTISOString(),
        })
        .eq("complaint_id", complaintId);

      if (updateError) {
        return { success: false, message: updateError.message };
      }

      return { success: true, message: "Service Agent assigned successfully" };
    }

    return {
      success: false,
      message: "Staff record not found.",
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    logger.error({
      level: "error",
      action: "assign-staff",
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });
    return { success: false, message: errorMessage };
  }
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      logger.info({
        level: "info",
        action: "assign-complaint",
        userId: authCtx.user.id,
        message: "Assign complaint request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.");
      }

      const {
        societyRegistrationNumber,
        complaintId,
        staffId,
      } = body as AssignComplaintRequest;

      if (!societyRegistrationNumber) {
        return errorResponse("societyRegistrationNumber is mandatory.");
      }

      if (!complaintId) {
        return errorResponse("complaintId is mandatory.");
      }

      const regNum = sanitizeString(societyRegistrationNumber);
      const cleanComplaintId = sanitizeString(complaintId);

      // Get Society
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        return errorResponse("Failed to fetch society data.");
      }

      if (!society) {
        return errorResponse(
          "Society not found for provided registration number.",
        );
      }

      // Get Complaint
      const { data: complaint, error: compErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
          complaint_id,
          name,
          complaint_type,
          status,
          assigned_agent,
          non_society_user,
          society_user,
          society_user_data:SSP_Society_User!society_user (
            society
          )
        `)
        .eq("complaint_id", cleanComplaintId)
        .maybeSingle();

      if (compErr) {
        return errorResponse(`Failed to fetch complaint: ${compErr.message}`);
      }

      if (!complaint) {
        return errorResponse(
          "Complaint not found. Please check the complaint ID.",
        );
      }

      const societyUserData = firstOrNull(complaint.society_user_data);

      if (!societyUserData || societyUserData.society !== society.society_id) {
        return errorResponse("Complaint not found for this society.");
      }

      const complaintData = complaint as ComplaintData;

      // Manual Assignment
      if (staffId && String(staffId).trim() !== "") {
        const cleanStaffId = sanitizeString(staffId);
        const assignment = await assignStaffToRecord(
          complaintData.complaint_id,
          cleanStaffId,
        );

        if (!assignment.success) {
          return errorResponse(assignment.message || "Assignment failed.");
        }

        return successResponse({
          assignmentStatus: {
            assigned: true,
            message: assignment.message || "Staff assigned successfully.",
          },
          availableStaff: [],
        });
      }

      // Find Available Staff
      const complaintType = String(complaintData.complaint_type || "general")
        .trim();
      const normalizedComplaintType = complaintType.toLowerCase();
      const isOtherComplaint = normalizedComplaintType === "other" ||
        normalizedComplaintType === "others";

      const availableStaff: AvailableStaff[] = [];

      // Fetch Service Agents with rating (FIRST - Service Agents should appear first)
      const { data: allAgents, error: agentErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
          user_id,
          role,
          service_agent_services,
          agent_availability_status,
          service_agent_rating,
          contact:contact (
            name,
            phone
          )
        `)
        .eq("society", society.society_id);

      if (agentErr) {
        logger.error({
          level: "error",
          action: "assign-complaint",
          message: `Agent fetch error: ${agentErr.message}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Filter agents with "Service Agent" in role
      const serviceAgents = ((allAgents || []) as RawAgentData[]).filter(
        (agent) => {
          const roles = agent.role || [];
          return roles.includes("service_agent");
        },
      );

      logger.info({
        level: "info",
        action: "assign-complaint",
        message: `Found ${serviceAgents.length} service agents in society`,
        agentCount: serviceAgents.length,
        timestamp: new Date().toISOString(),
      });

      if (serviceAgents.length > 0) {
        // First try to match by service type
        const matchedAgents = serviceAgents.filter((agent) => {
          const services = parseServiceTypes(agent.service_agent_services);
          if (services.length === 0) return false;
          return matchesComplaintType(
            services,
            normalizedComplaintType,
            isOtherComplaint,
          );
        });

        // If no matches, show all service agents
        const agentsToShow = matchedAgents.length > 0
          ? matchedAgents
          : serviceAgents;

        logger.info({
          level: "info",
          action: "assign-complaint",
          message:
            `Matched ${matchedAgents.length} agents, showing ${agentsToShow.length} agents total`,
          matchedCount: matchedAgents.length,
          totalToShow: agentsToShow.length,
          timestamp: new Date().toISOString(),
        });

        agentsToShow.forEach((agent) => {
          const contact = firstOrNull(agent.contact);

          let ratingString: string | null = null;
          if (
            agent.service_agent_rating !== null &&
            agent.service_agent_rating !== undefined
          ) {
            ratingString = Number(agent.service_agent_rating).toFixed(2);
          }

          availableStaff.push({
            id: agent.user_id,
            name: contact?.name || "Unknown Agent",
            phone: contact?.phone || null,
            role: "service_agent",
            serviceType: agent.service_agent_services,
            rating: ratingString,
          });
        });
      }

      // Fetch Vendors with rating (SECOND - Vendors should appear after Service Agents)
      const { data: allVendors, error: vendorErr } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
          non_society_user_id,
          name,
          role,
          service_type,
          phone_number,
          vendor_rating
        `)
        .eq("society", society.society_id)
        .eq("role", "vendor");

      if (!vendorErr && allVendors && allVendors.length > 0) {
        const matchedVendors = (allVendors as VendorData[]).filter((vendor) => {
          const services = parseServiceTypes(vendor.service_type);
          if (services.length === 0) return false;
          return matchesComplaintType(
            services,
            normalizedComplaintType,
            isOtherComplaint,
          );
        });

        const vendorsToShow = matchedVendors.length > 0
          ? matchedVendors
          : allVendors;

        vendorsToShow.forEach((vendor) => {
          availableStaff.push({
            id: vendor.non_society_user_id,
            name: vendor.name || "Unknown Vendor",
            phone: vendor.phone_number || null,
            role: "vendor",
            serviceType: vendor.service_type,
            rating: vendor.vendor_rating || null,
          });
        });
      }

      // Remove Duplicates
      const uniqueStaff = Array.from(
        new Map(availableStaff.map((staff) => [staff.id, staff])).values(),
      );

      // Sort Staff: Service Agents first (by rating desc), then Vendors (by rating desc)
      const sortedStaff = sortStaff(uniqueStaff);

      // Evaluate Assignment
      const totalStaffCount = sortedStaff.length;
      const assignmentStatus: AssignmentStatus = {
        assigned: false,
        message: "",
      };

      if (totalStaffCount === 1) {
        const targetStaff = sortedStaff[0];
        const autoAssignment = await assignStaffToRecord(
          complaintData.complaint_id,
          targetStaff.id,
        );

        if (autoAssignment.success) {
          assignmentStatus.assigned = true;
          assignmentStatus.message =
            `Auto-assigned to ${targetStaff.name} (${targetStaff.role})`;
        } else {
          assignmentStatus.assigned = false;
          assignmentStatus.message = "Automatic assignment failed.";
        }
      } else if (totalStaffCount > 1) {
        assignmentStatus.assigned = false;
        assignmentStatus.message =
          `Multiple staff available (${totalStaffCount}). Please select one manually.`;
      } else {
        assignmentStatus.assigned = false;
        assignmentStatus.message =
          "No staff available for this complaint type.";
      }

      return successResponse({
        assignmentStatus,
        availableStaff: sortedStaff,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";

      logger.error({
        level: "error",
        action: "assign-complaint",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(errorMessage || "Failed to assign complaint.");
    }
  }),
);
