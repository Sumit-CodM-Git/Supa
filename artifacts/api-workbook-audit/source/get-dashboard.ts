import { parkingCounts } from "../_shared/parking-counts.ts";
import { contactParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface Contact {
    parking_slot?: string | null;
    contact_id: string;
    name: string;
    phone: string;
    email: string;
    gender: string;
}
interface Society {
    society_id: string;
    society_name: string;
    registration_number: string;
    subscription_plan: string;
    address_line1: string;
    city: string;
    state: string;
    total_unit: number;
    parking_slot: number;
    covered_parking: number | null;
}
interface TowerResponse {
    towerId: string;
    towerName: string;
}
interface BlockResponse {
    blockId: string;
    blockName: string;
}
interface Alert {
    alert_id: string;
    title: string;
    message: string;
    type: string;
    published_date: string;
    created_at: string;
}
interface EnrichedSocietyUser {
    user_id: string;
    role: string | string[];
    unit_flat_number: string;
    user_type: string;
    user_ownership_type: string;
    status: boolean;
    move_in_date: string | null;
    created_at: string;
    contact: Contact | null;
    society: Society | null;
    tower: TowerResponse | null;
    block: BlockResponse | null;
}
interface FormattedAlert {
    id: string;
    title: string;
    message: string;
    type: string;
    publishedDate: string;
    createdAt: string;
    isToday: boolean;
}
interface DashboardResponse {
    user: {
        parkingSlot: string | null;
        id: string;
        name: string;
        phone: string;
        email: string | null;
        gender: string | null;
        flatNumber: string;
        tower: TowerResponse | null;
        block: BlockResponse | null;
        userType: string;
        ownershipType: string;
        status: boolean;
        moveInDate: string | null;
        joinedDate: string | null;
        role: string[];
    };
    society: {
        id: string | null;
        name: string;
        registrationNumber: string | null;
        subscriptionPlan: string;
        address: string;
        statistics: {
            totalFlats: number;
            occupiedFlats: number;
            vacantFlats: number;
            owners: number;
            tenants: number;
            totalParking: number;
            occupiedParking: number;
            vacantParking: number;
            twoWheelers: number;
            fourWheelers: number;
        };
    };
    complaints: {
        total: number;
        pending: number;
        resolved: number;
    };
    bookings: {
        upcoming: number;
        confirmed: number;
    };
    alerts: {
        items: FormattedAlert[];
        hasTodayAlerts: boolean;
        message: string;
    };
}
interface AuthContext {
    user: {
        id: string;
        user_metadata?: {
            phone?: string;
        };
    };
}
function buildErrorResponse(code: string, message: string, status: number): Response {
    console.error(`❌ [${code}] ${message}`);
    return new Response(JSON.stringify({ success: false, error: code, message: message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
function successResponse(data: DashboardResponse): Response {
    return new Response(JSON.stringify({ success: true, data: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
function toTowerResponse(row: {
    tower_id: string;
    name: string;
}): TowerResponse {
    return {
        towerId: row.tower_id,
        towerName: row.name,
    };
}
function toBlockResponse(row: {
    block_id: string;
    block_name: string;
}): BlockResponse {
    return {
        blockId: row.block_id,
        blockName: row.block_name,
    };
}
async function getSmartAlerts(supabaseAdmin: any, societyId: string): Promise<{
    todayAlerts: Alert[];
    upcomingAlerts: Alert[];
    hasTodayAlerts: boolean;
}> {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        console.log(`📅 Today: ${todayStr}`);
        console.log(`🏢 Society ID: ${societyId}`);
        const { data: allAlerts, error } = await supabaseAdmin
            .from("SSP_Alert")
            .select(`alert_id, title, message, type, published_date, created_at`)
            .eq("society", societyId)
            .gte("published_date", todayStr)
            .order("published_date", { ascending: true })
            .limit(10);
        if (error) {
            console.error("❌ Alert fetch error:", error);
            return {
                todayAlerts: [],
                upcomingAlerts: [],
                hasTodayAlerts: false,
            };
        }
        if (!allAlerts || allAlerts.length === 0) {
            console.log("📭 No alerts found for today or future");
            return {
                todayAlerts: [],
                upcomingAlerts: [],
                hasTodayAlerts: false,
            };
        }
        console.log(`📋 Found ${allAlerts.length} alerts`);
        const todayAlerts: Alert[] = [];
        const upcomingAlerts: Alert[] = [];
        for (const alert of allAlerts) {
            const alertDate = alert.published_date.split("T")[0];
            if (alertDate === todayStr) {
                todayAlerts.push(alert);
            }
            else if (alertDate > todayStr) {
                upcomingAlerts.push(alert);
            }
        }
        todayAlerts.sort((a, b) => new Date(b.published_date).getTime() -
            new Date(a.published_date).getTime());
        upcomingAlerts.sort((a, b) => new Date(a.published_date).getTime() -
            new Date(b.published_date).getTime());
        const limitedTodayAlerts = todayAlerts.slice(0, 2);
        const limitedUpcomingAlerts = upcomingAlerts.slice(0, 2);
        console.log(`📊 Today alerts: ${limitedTodayAlerts.length}, Upcoming alerts: ${limitedUpcomingAlerts.length}`);
        return {
            todayAlerts: limitedTodayAlerts,
            upcomingAlerts: limitedUpcomingAlerts,
            hasTodayAlerts: limitedTodayAlerts.length > 0,
        };
    }
    catch (error) {
        console.error("❌ Error in getSmartAlerts:", error);
        return { todayAlerts: [], upcomingAlerts: [], hasTodayAlerts: false };
    }
}
function formatAlertResponse(alert: Alert, isToday: boolean): FormattedAlert {
    return {
        id: alert.alert_id,
        title: alert.title || "Untitled",
        message: alert.message || "",
        type: alert.type || "info",
        publishedDate: alert.published_date,
        createdAt: alert.created_at,
        isToday: isToday,
    };
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: AuthContext) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        console.log("📊 get-dashboard called");
        if (req.method !== "GET") {
            return buildErrorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed.", 405);
        }
        const userId = authCtx.user.id;
        console.log(`🔑 User ID from auth context: ${userId}`);
        if (!userId) {
            return buildErrorResponse("INVALID_TOKEN", "User ID not found in token. Please login again.", 401);
        }
        console.log(`🔍 Searching for user with ID: ${userId}`);
        const { data: userData, error: userError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
                    user_id,
                    role,
                    unit_flat_number,
                    user_type,
                    user_ownership_type,
                    status,
                    move_in_date,
                    created_at,
                    contact,
                    society,
                    tower,
                    block
                `)
            .eq("user_id", userId)
            .single();
        if (userError || !userData) {
            console.error(`❌ User not found with ID: ${userId}`);
            console.error("❌ Error:", userError);
            const userPhone = authCtx.user.user_metadata?.phone;
            if (userPhone) {
                console.log(`📱 Trying to find user by phone: ${userPhone}`);
                const { data: contactData, error: contactError } = await supabaseAdmin
                    .from("SSP_Contact")
                    .select(`parking_slot, contact_id, name, phone, email, gender`)
                    .eq("phone", userPhone)
                    .maybeSingle();
                if (!contactError && contactData) {
                    console.log("✅ Contact found:", contactData.contact_id);
                    const { data: societyUserData, error: societyUserError, } = await supabaseAdmin
                        .from("SSP_Society_User")
                        .select(`
                                    user_id,
                                    role,
                                    unit_flat_number,
                                    user_type,
                                    user_ownership_type,
                                    status,
                                    move_in_date,
                                    created_at,
                                    society,
                                    tower,
                                    block
                                `)
                        .eq("contact", contactData.contact_id)
                        .maybeSingle();
                    if (!societyUserError && societyUserData) {
                        const foundUser: EnrichedSocietyUser = {
                            ...societyUserData,
                            contact: contactData,
                            society: null,
                            tower: null,
                            block: null,
                        };
                        console.log(`✅ User found by phone: ${contactData.name}`);
                        return await buildDashboardResponse(foundUser, [], false);
                    }
                }
            }
            return buildErrorResponse("USER_NOT_FOUND", `User not found with ID: ${userId}`, 404);
        }
        let contactData: Contact | null = null;
        if (userData.contact) {
            const { data: contact, error: contactError } = await supabaseAdmin
                .from("SSP_Contact")
                .select(`parking_slot, contact_id, name, phone, email, gender`)
                .eq("contact_id", userData.contact)
                .single();
            if (!contactError && contact) {
                contactData = contact;
                console.log("✅ Contact found:", contactData.name);
            }
        }
        let societyData: Society | null = null;
        if (userData.society) {
            const { data: society, error: societyError } = await supabaseAdmin
                .from("SSP_Society")
                .select(`
                        society_id,
                        society_name,
                        registration_number,
                        subscription_plan,
                        address_line1,
                        city,
                        state,
                        total_unit,
                        parking_slot,
                        covered_parking
                    `)
                .eq("society_id", userData.society)
                .single();
            if (!societyError && society) {
                societyData = society;
                console.log("✅ Society found:", societyData.society_name);
            }
        }
        let towerData: TowerResponse | null = null;
        if (userData.tower) {
            const { data: tower, error: towerError } = await supabaseAdmin
                .from("SSP_Tower")
                .select(`tower_id, name`)
                .eq("tower_id", userData.tower)
                .single();
            if (!towerError && tower) {
                towerData = toTowerResponse(tower);
            }
        }
        let blockData: BlockResponse | null = null;
        if (userData.block) {
            const { data: block, error: blockError } = await supabaseAdmin
                .from("SSP_Block")
                .select(`block_id, block_name`)
                .eq("block_id", userData.block)
                .single();
            if (!blockError && block) {
                blockData = toBlockResponse(block);
            }
        }
        const user: EnrichedSocietyUser = {
            ...userData,
            contact: contactData,
            society: societyData,
            tower: towerData,
            block: blockData,
        };
        console.log(`✅ User found: ${user.contact?.name || "Unknown"} (ID: ${user.user_id})`);
        const alertData = await getSmartAlerts(supabaseAdmin, user.society?.society_id || "");
        const formattedAlerts: FormattedAlert[] = [
            ...alertData.todayAlerts.map((a) => ({
                ...formatAlertResponse(a, true),
                isToday: true,
            })),
            ...alertData.upcomingAlerts.map((a) => ({
                ...formatAlertResponse(a, false),
                isToday: false,
            })),
        ];
        return await buildDashboardResponse(user, formattedAlerts, alertData.hasTodayAlerts);
    }
    catch (error: unknown) {
        const err = error as Error;
        console.error("❌ Dashboard error:", err);
        return buildErrorResponse("SERVER_ERROR", err.message || "Failed to fetch dashboard data", 500);
    }
}));
async function buildDashboardResponse(user: EnrichedSocietyUser, alerts: FormattedAlert[], hasTodayAlerts: boolean): Promise<Response> {
    try {
        let owners = 0, tenants = 0, twoWheelers = 0, fourWheelers = 0;
        if (user.society?.society_id) {
            const { data: allUsers } = await supabaseAdmin
                .from("SSP_Society_User")
                .select(`user_type, contact`)
                .eq("society", user.society.society_id);
            if (allUsers && allUsers.length > 0) {
                const contactIds = allUsers
                    .map((u: {
                    contact: string | null;
                }) => u.contact)
                    .filter((c: string | null): c is string => !!c);
                let vehicleMap = new Map<string, string>();
                if (contactIds.length > 0) {
                    const { data: contacts } = await supabaseAdmin
                        .from("SSP_Contact")
                        .select("parking_slot, contact_id, vehicle_type")
                        .in("contact_id", contactIds);
                    if (contacts) {
                        for (const c of contacts) {
                            vehicleMap.set(c.contact_id, c.vehicle_type ?? "");
                        }
                    }
                }
                for (const u of allUsers) {
                    const type = String(u.user_type ?? "").toLowerCase();
                    if (type === "owner")
                        owners++;
                    if (type === "tenant")
                        tenants++;
                    if (u.contact) {
                        const vehicle = String(vehicleMap.get(u.contact) ?? "").toLowerCase();
                        if (vehicle === "two_wheeler")
                            twoWheelers++;
                        if (vehicle === "four_wheeler")
                            fourWheelers++;
                    }
                }
            }
        }
        const totalFlats = Number(user.society?.total_unit ?? 0);
        const occupiedFlats = owners + tenants;
        const { totalParking, occupiedParking, vacantParking } = parkingCounts(user.society);
        let totalComplaints = 0, pendingComplaints = 0, resolvedComplaints = 0;
        let upcomingBookings = 0, confirmedBookings = 0;
        try {
            const { count: total } = await supabaseAdmin
                .from("SSP_Complaint")
                .select("*", { count: "exact", head: true })
                .eq("society_user", user.user_id);
            totalComplaints = total || 0;
            const { count: pending } = await supabaseAdmin
                .from("SSP_Complaint")
                .select("*", { count: "exact", head: true })
                .eq("society_user", user.user_id)
                .eq("status", "pending");
            pendingComplaints = pending || 0;
            const { count: resolved } = await supabaseAdmin
                .from("SSP_Complaint")
                .select("*", { count: "exact", head: true })
                .eq("society_user", user.user_id)
                .eq("status", "resolved");
            resolvedComplaints = resolved || 0;
            const today = new Date().toISOString();
            const { count: upcoming } = await supabaseAdmin
                .from("SSP_Facility_Booking")
                .select("*", { count: "exact", head: true })
                .eq("requested_by", user.user_id)
                .gte("booking_start_date", today);
            upcomingBookings = upcoming || 0;
            const { count: confirmed } = await supabaseAdmin
                .from("SSP_Facility_Booking")
                .select("*", { count: "exact", head: true })
                .eq("requested_by", user.user_id)
                .eq("approval_status", "approved");
            confirmedBookings = confirmed || 0;
        }
        catch (e) {
            console.error("Count fetch error:", e);
        }
        const roles = Array.isArray(user.role)
            ? user.role
            : [user.role || "resident"];
        const responseData: DashboardResponse = {
            user: {
                parkingSlot: contactParkingSlot(user.contact),
                id: user.user_id,
                name: user.contact?.name || "User",
                phone: user.contact?.phone || "",
                email: user.contact?.email || null,
                gender: user.contact?.gender || null,
                flatNumber: user.unit_flat_number || "N/A",
                tower: user.tower,
                block: user.block,
                userType: user.user_type || "owner",
                ownershipType: user.user_ownership_type || "primary",
                status: user.status ?? true,
                moveInDate: user.move_in_date || null,
                joinedDate: user.created_at || null,
                role: roles.map((r) => String(r)),
            },
            society: {
                id: user.society?.society_id || null,
                name: user.society?.society_name || "N/A",
                registrationNumber: user.society?.registration_number || null,
                subscriptionPlan: user.society?.subscription_plan || "growth",
                address: user.society
                    ? `${user.society.address_line1 || ""}, ${user.society.city || ""}, ${user.society.state || ""}`.trim()
                    : "N/A",
                statistics: {
                    totalFlats: totalFlats || 0,
                    occupiedFlats: occupiedFlats || 0,
                    vacantFlats: Math.max(0, totalFlats - occupiedFlats) || 0,
                    owners: owners || 0,
                    tenants: tenants || 0,
                    totalParking: totalParking || 0,
                    occupiedParking: occupiedParking || 0,
                    vacantParking: vacantParking,
                    twoWheelers: twoWheelers || 0,
                    fourWheelers: fourWheelers || 0,
                },
            },
            complaints: {
                total: totalComplaints || 0,
                pending: pendingComplaints || 0,
                resolved: resolvedComplaints || 0,
            },
            bookings: {
                upcoming: upcomingBookings || 0,
                confirmed: confirmedBookings || 0,
            },
            alerts: {
                items: alerts,
                hasTodayAlerts: hasTodayAlerts,
                message: hasTodayAlerts
                    ? `You have ${alerts.filter((a) => a.isToday).length} alert(s) today`
                    : "No notices/alerts/events published for today",
            },
        };
        return successResponse(responseData);
    }
    catch (error: unknown) {
        const err = error as Error;
        console.error("❌ Build dashboard error:", err);
        return buildErrorResponse("SERVER_ERROR", err.message || "Failed to build dashboard data", 500);
    }
}
