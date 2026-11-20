"""Refresh API contracts from audited TypeScript facts; preserve unrelated XLSX parts."""
from pathlib import Path
import copy,datetime,hashlib,json,re,shlex,zipfile,xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[2]
AUDIT=ROOT/'artifacts/api-workbook-audit'
WORKBOOK=ROOT/'Copy of Society Sync Pro 2.0 - APIs.xlsx'
OUTPUT=ROOT/'Society Sync Pro 2.0 - APIs - Updated.xlsx'
DATE='2026-11-11'
BASE='https://isrqhkshygauaehwfycw.supabase.co/functions/v1/'
contracts=json.loads((AUDIT/'contracts.json').read_text())
deployed={d['slug']:d for d in json.loads((AUDIT/'deployed-functions.json').read_text())}
original=json.loads((AUDIT/'original-rows.json').read_text())
# Reviewed descriptions explain observable behavior, rather than obsolete workbook text.
descriptions={
'add-members':'Create society members or vendors in the selected society. Normalizes contact and role picklists, reuses matching contacts, validates identity proof, and returns created records. Resident flat-type fields are optional; parkingSlot supports create, preserve and clear behavior.',
'update-member':'Update a society member or vendor by memberId. Preserves omitted fields, validates role/ownership/status/contact values, saves parkingSlot on the contact, and synchronizes available auth metadata. Optional flatTypeId or flatType resolves an active type in the member’s society.',
'delete-members':'Society-admin-only member removal within the caller’s society. Society users are archived with deleted_at and inactive status; OTP is cleared while contacts, payments, complaints and visitor history are preserved. Vendor handling follows its separate record type.',
'get-members':'List society members and non-society users with role, status, flat, block, tower, search and pagination filters. Includes resident flatTypeId/flatType and the current contact parkingSlot; users without an assigned flat type remain in the list.',
'crud-family':'Create, view, update, remove, restore and change the primary member within the authenticated resident’s flat. Flat context is loaded from the caller’s society-user record. Primary-only mutations and secondary self-edit permissions apply; role is clamped to resident. New members inherit an active flat type by default; stale inherited types do not block older create requests.',
'get-profile':'Retrieve contact, society-user, society address, service-agent and vendor details for phoneNumber, registrationNumber and role. Resident societyUser includes flatTypeId and flatType.',
'get-residents-profile':'Fetch resident profile information by society registration and resident identifier, with optional role and pagination. Returns personal, contact and residential information; flatTypeId/flatType appear in residentialInformation.',
'update-residents-profile':'FETCH a filtered resident directory or UPDATE a selected resident profile in a society. Accepts optional flatTypeId/flatType and contact parkingSlot; omitted flat-type fields preserve the assignment and explicit null clears it.',
'resident-profile-console':'Authenticated FETCH_ONE, FETCH_ALL and UPDATE resident profile operations. Preserves field validation, existing response fields, filters and pagination. Flat-type fields are optional; updates follow existing staff-field authorization and same-society active-type validation.',
'search-resident':'Search active, non-deleted primary residents by society and flat for security/admin callers. Includes tower/block names, flatTypeId/flatType, parkingSlot, visitor OTP availability and resident plan code.',
'get-society-settings':'Admin society settings response includes society details, all society blocks (active and inactive), active towers, active configured flat types, staff and facilities. Provides societyConfiguration and configurationVersion. Blocks remain isolated to the requested society.',
'get-picklists':'Return field metadata and picklists for the requesting active society user. Society configuration is authoritative for all roles/scopes: active towers, all blocks including inactive, and active society flat types. Global flatTypeCatalog remains available for configuring new society types. Supports private revalidation with ETag and HTTP 304.',
'crud-flat-type':'Manage society flat-type configuration. DELETE atomically clears that society’s resident/society assignments and maintenance charges, then marks its configuration inactive. Resident accounts/history and the global option catalog are preserved. CREATE can reactivate the society’s matching inactive row; VIEW excludes inactive configurations.',
'crud-block':'Manage blocks scoped to the authorized admin’s society. VIEW includes active and inactive blocks by default, with an explicit active filter available. CREATE/UPDATE accepts tower ID/name aliases and camelCase or snake_case block names.',
'crud-tower':'Manage society towers with active status, floors, flats_per_floor and optional parent block. Accepts block ID/name aliases and validates active parent references within the same society. VIEW defaults to both statuses; active tower capacities determine society unit totals.',
'crud-society':'View or update society profile and parking capacity for an authorized society admin. Total units are derived from active tower capacity; totalParkingSlot is configurable.',
'crud-society-staff':'Create, list, update and delete society staff, including role, phone, shift, availability and emergency-contact/category details. Supports filters, sorting and pagination.',
'crud-notice':'Merged notice CREATE, VIEW, UPDATE and DELETE operations. Supports society-scoped authorization, notice audiences, type/priority, dates, search, sorting, pagination and idempotency. Updates/deletes require the admin permissions enforced by the function.',
'get-resident-notices':'Fetch notices for a resident’s society with type, priority, date, search, sort, expiry and pagination controls.',
'crud-servant':'Merged servant CREATE, VIEW, UPDATE and DELETE operations. Supports recurring schedules, roles, shifts, identity proof, filters and image lifecycle. Admin permissions apply to update and removal.',
'servant-detail':'Return one servant’s profile, document/image information, recurring schedule and current in/out status.',
'manage-servant-hire':'Hire or lay off a servant for a specified resident and society. Hiring requires roles and recurringDays when recurrence is enabled.',
'hired-available-servants':'List hired and available servants for a resident with role, recurring-day, shift, date and pagination filters, including normalized in/out status.',
'manage-resident-servants':'Authenticated resident servant DETAIL, HIRE, LAYOFF and VIEW operations, deriving the resident context from the caller and supporting hired/available and scheduling filters.',
'get-otp':'Generate and save the current six-digit DDMMYY login OTP for a matching phone and society registration. Looks up eligible society users or vendors and excludes removed users.',
'verify-otp':'Verify a matching login OTP and return the authentication token/session and role-related identifiers. Dashboard data is retrieved separately. Removed or inactive records cannot log in.',
'get-dashboard':'Return the authenticated user’s dashboard, society statistics and role-specific summaries. Parking totals use configured slots and occupied parking; registered vehicle counts are independent. Includes the current contact parkingSlot.',
'get-societies':'GET society listing with optional authentication, pagination and column filters. /me requires authentication; /<id> retrieves a single society using the implemented route lookup.',
'get-visitors':'List society visitors with approval/status, role, host, flat location, recurring, date, search and pagination filters. OTP drafts are excluded from normal visitor lists.',
'my-visitors':'List visitors for the specified resident and flat with approval/status, recurring, role, date, search and pagination filters.',
'resident-visitor-logs':'Return a resident’s visitor history using society and resident identifiers with role, visitor-status, date, search and pagination filters.',
'resident-visitor':'Merged resident VIEW and LOGS visitor operations. Caller context determines the resident and flat. Supports approval/status, pre-approval, recurring, role, date, search and pagination filters.',
'crud-pre-approved-visitor':'Create, view, update and remove the authenticated resident’s pre-approved visitors. Supports recurring days, visitor image metadata, pagination and filters; caller context determines host and society.',
'visitor-otp':'Generate or verify a visitor-phone OTP for a target resident. Accepts visitorName or name and returns the saved name. Phone verification and complete visitor details are separate stages; incomplete OTP drafts do not trigger approval notifications or occupy the normal visitor list.',
'visitor-pass-operations':'Unified security visitor and servant operations: pre-approvals, approval requests, visitor in/out status, inside logs, flat-based resident/servant lookup and servant status. Image operations support upload, confirmation and retrieval. Preserves visitor names, requires verified OTP where applicable, and prevents duplicate approval notifications.',
'security-gate-console':'Security visitor pre-approval lookup, approval requests, status changes and inside logs. Supports flat/location filters, date/pagination and visitor names/phone. Search includes phoneNumber, name, vehicleNumber, purpose, flatNumber and towerName where implemented.',
'security-guard-image':'Upload or fetch visitor/security images using metadata and optional base64 content. Supports individual document lookup and filtered FETCH_ALL.',
'update-approval-status':'Route SendForApproval, Approved and Reject visitor transitions. Only society security requests approval; only the host resident approves/rejects. Uses the verified visitor state and suppresses duplicate notifications.',
'create-complaint-resident':'Create a resident complaint with society/resident identifiers, title and description. Supports type, priority and multiple image upload descriptors, with legacy single-file aliases.',
'crud-resident-complaint':'Authenticated resident CREATE, VIEW and UPDATE complaints. Supports before/details images, document removal, idempotency, date/status/type/priority filters, sorting and pagination.',
'get-complaints':'List society complaints with status, priority, type, date range, search and pagination filters.',
'assign-complaint':'Assign a complaint to a staff/service-agent record in a society, or apply the endpoint’s unassignment behavior when staffId is omitted.',
'resident-complaints':'List a selected resident’s complaints with status, priority, type, date, search and pagination filters.',
'manage-complaint-admin':'Admin/superadmin VIEW, ASSIGN and STAFF_LIST complaint workflows. Assignment validates a vendor/service-agent within the same society; view includes filters, sorting and pagination.',
'staff-complaints':'Staff complaint FETCH, UPDATE and UPDATE_AVAILABILITY operations for service agents/vendors. Filters include status, complaint type, priority, dates and search. Staff workflow rules apply to status transitions.',
'complaint-otp':'Fetch or verify complaint START/END OTP according to stage and optional otp. Caller/assignee authorization and the complaint lifecycle govern valid transitions.',
'staff-complaint-images':'Upload, fetch or delete BEFORE/AFTER complaint images. Upload descriptors and confirmation are supported; only service agents/vendors may upload the work images.',
'staff-complaint-workflow':'Merged staff complaint OTP and image workflow. Supports fetching OTP, before/after image upload/fetch/delete, starting/ending OTP and verifying start/end; complaint assignment and lifecycle rules apply.',
'get-facilities-details':'Return society facilities with type, rules, charges, booking mode, maintenance/opening details and image collections. Supports multiple facility images, limited to five active images per facility.',
'get-facility-schedule':'Return availability slots for a society facility selected by name/type on a booking date, accounting for closed days, maintenance and blocking bookings.',
'get-facility-bookings':'List both confirmed facility bookings and pending booking requests. Supports status, facilityId/facilityName, date range, searchQuery and pagination. Includes recordType, requestId, payment details and receipt upload state.',
'crud-facility':'Authorized facility CREATE, VIEW, UPDATE and DELETE. Supports facility settings, maintenance, filtering and multiple images (maximum five); images[] and deleteImageIds enable targeted lifecycle changes while legacy single-image fields remain supported.',
'facility-console':'Merged facility detail, schedule and authenticated caller booking-list operations using actionType. Facility schedule requires facilityName or facilityType and bookingDate.',
'facility-booking-action':'Update a booking approval/status in a society. Reject requires a reason; rejection releases reservation/slot state without duplicating booking records.',
'facility-booking-admin':'Admin VERIFY_PAYMENT and UPDATE_STATUS booking workflows. Payment verification resolves payment/request/booking state atomically where implemented and handles repeats; rejection/cancellation releases reserved capacity.',
'get-my-facility-bookings':'Return resident booking/request history for societyRegistrationNumber and residentId, including payment/receipt and cancellation status.',
'resident-facility-booking':'Resident facility listing, blocked-slot lookup, booking, booking history, cancellation and pending-booking abort. Supports payment receipt upload descriptors. Cancellation/abort releases reserved slots and capacity; receipt upload state is reported.',
'verify-booking-facility':'Verify or reject a facility payment using payId and approvalStatus. Validates society context and reconciles booking/request records; repeated verification avoids duplicate bookings.',
'create-marketplace':'Create a society marketplace listing with images. Price is required unless priceType is Free; at least one image descriptor is required. Returns listing and upload-related information.',
'get-marketplace':'Browse marketplace listings by registrationNumber, category, status, search and pagination, including associated images.',
'resident-marketplace':'Resident marketplace list/update/delete and image-management operations. Validates owner access for mutations and manages uploaded documents.',
'resident-marketplace-console':'Merged resident marketplace CREATE, FETCH_OWN, UPDATE, ADD_IMAGES, DELETE_IMAGES and DELETE. Supports paginated own listings and metadata-driven image upload/delete.',
'marketplace-browse':'Merged marketplace BROWSE, TOGGLE_WISHLIST and FETCH_WISHLIST, with society selection, category/status/search and pagination.',
'resident-wishlist':'Toggle an item’s wishlist state or list saved items for the requested society user, including listing images and pagination.',
'vendor-management':'Authenticated vendor CREATE, FETCH, UPDATE and DELETE operations scoped by society. Supports contact/identity/vehicle/service/rating data and paginated search.',
'get-payments-list':'Return the society payment ledger with paymentStatus, paymentType and searchText filters plus URL pagination. Includes resident/location and receipt details.',
'admin-payments-console':'Merged admin FETCH_ALL and VERIFY_PAYMENT ledger operations. Applies payment filters/search/pagination and verifies/rejects a selected payment with required rejection reason.',
'view-resident-payments':'List the authenticated resident’s ledger for a society, with status, payment type, search and pagination. Includes receipt upload/delivery state.',
'make-resident-payment':'Submit a resident payment for review and optionally request a signed receipt-image upload URL using fileName/fileType. Identifies the society, resident and payment record.',
'resident-payments-console':'Merged resident SUBMIT_PAYMENT, CONFIRM_RECEIPT_UPLOAD and FETCH_OWN. Submission can produce an upload URL; confirmation verifies receipt state. Own ledger supports filtering, search and pagination.',
'verify-payment':'Verify or reject a society payment. Accepts JSON or multipart receiptImage upload; successful facility-payment verification reconciles pending booking requests.',
'generate-payment-receipt':'Authenticated payment receipt endpoint. list:true returns the caller’s eligible paid payments; paymentId downloads a PDF by default, or returns a signed URL with responseFormat:url. Resolves current resident/location data and reuses/generates stored receipts.',
'get-subscription-info':'GET subscription plans, authenticated current plan summary or payment history, selected by the action query parameter. Deployed gateway JWT verification applies independently of optional-auth behavior in the handler.',
'create-razorpay-order':'Create a Razorpay order for a chosen planCode and billingPeriod using the caller’s flat/subscription scope. Returns provider checkout order details; no raw secret is returned.',
'verify-razorpay-payment':'Verify the Razorpay checkout signature and reconcile the order/payment/subscription using provider IDs. Supports idempotent processing and preserved order scope.',
'razorpay-webhook':'Provider callback verified by x-razorpay-signature over the raw body. Handles captured-payment/order events, correlates subscription scope and avoids duplicate processing using provider event/order identifiers.',
'manage-subscription':'Activate the free plan or cancel the caller’s subscription with an optional reason, subject to ownership and plan rules.',
'manage-subscription-payment':'Create subscription RENEW or UPGRADE checkout/payment actions. Requires billingPeriod and newPlanCode for UPGRADE; subscription ownership applies.',
'renew-subscription':'Create a renewal checkout order for the caller’s existing subscription and requested billingPeriod; subscription owner authorization applies.',
'upgrade-subscription':'Create an upgrade checkout order for newPlanCode and billingPeriod; enforces subscription ownership and upgrade eligibility.',
'manage-transfer':'Request, accept, cancel or list society/member/gift subscription transfers. Transfer-specific targets and authorization are validated.',
'request-refund':'Preview or request a subscription refund using plan/payment eligibility and refund rules. Prorated refund requests require a reason of at least ten characters.',
'switch-user':'Switch authenticated context to a matching society registration, phone and role. Returns the selected user/context and role dashboard summaries with filters/pagination; parking capacity and registered vehicle counts remain separate.',
'process-csv-import':'Import a multipart CSV file with normalized headers for society_user or non_society_user rows. Returns successful/failed row reports with pagination and filters. Supports normalized contact parking-slot values.',
'update-parking-occupancy':'Update society covered-parking occupancy using an authorized security member. Input must be non-negative and is validated against configured parking capacity.',
'crud-document':'Admin document VIEW, UPLOAD, DOWNLOAD and DELETE. Upload uses request/confirm phases and signed URLs; supports document metadata, category/type/date/uploader filters, sorting and pagination.',
'crud-resident-document':'Resident document VIEW, UPLOAD, DOWNLOAD and DELETE. View supports own/shared/all scope; society-shared documents are read-only to residents, while personal document mutations remain owner-scoped.',
'save-fcm-token':'Register or remove a device FCM token, or remove all caller devices. Supports society_user/staff/vendor context, device type and optional model/OS/app metadata.',
'cleanup-fcm-tokens':'Internal/cron cleanup of inactive device tokens older than 90 days in batches. CRON_SECRET is checked when configured; deployed gateway JWT verification also applies.',
'create-sos':'Create an authenticated SOS alert with category, optional note and idempotency key. Resident/society context is derived from the caller.',
'send-sos-push':'Internal SOS dispatch: loads the persisted alert, checks status/rate-limit/idempotent claim state, selects eligible emergency staff, notifies devices and updates delivery results.',
'send-notification':'Internal database-webhook delivery of an SSP_Notification record to eligible FCM devices. Supports verified-visitor notification gating, token deactivation and persisted delivery outcomes.',
'search-contacts':'Search contacts within one society using searchKey and registrationNumber, with pagination. Returns matching contact records only from the selected society.',
}
descriptions['get-pending-approvals']='Return pending complaint and facility-booking approval summaries for a society. type selects ALL, COMPLAINTS or BOOKINGS; complaint and booking lists have separate URL pagination.'
assert set(descriptions)==set(contracts),(set(contracts)-set(descriptions))
# Request contracts for handlers without a dedicated request interface.
manual={
'get-dashboard':{},'get-societies':{},'get-subscription-info':{},'cleanup-fcm-tokens':{},
'get-facilities-details':{'societyRegistrationNumber':'string'},
'get-facility-bookings':{'societyRegistrationNumber':'string','status?':'string','facilityId?':'string','facilityName?':'string','startDate?':'string','endDate?':'string','searchQuery?':'string','page?':'number','limit?':'number'},
'get-my-facility-bookings':{'societyRegistrationNumber':'string','residentId':'string'},
'get-profile':{'phoneNumber':'string','registrationNumber':'string','role':'string'},
'get-residents-profile':{'societyRegistrationNumber':'string','residentId':'string','role?':'string'},
'get-pending-approvals':{'societyRegistrationNumber':'string','type?':{'union':['"ALL"','"COMPLAINTS"','"FACILITY"']}},
'make-resident-payment':{'societyRegistrationNumber':'string','residentId':'string','paymentId':'string','status?':'string','fileName?':'string','fileType?':'string'},
'view-resident-payments':{'societyRegistrationNumber':'string','status?':'string','paymentType?':'string','search?':'string','page?':'number','limit?':'number'},
'resident-marketplace':{'operation':'string','societyRegistrationNumber':'string','marketPlaceId?':'number','title?':'string','category?':'string','price?':'number','priceType?':'string','status?':'string','description?':'string','page?':'number','limit?':'number','search?':'string','files?':[{'fileName':'string','fileType?':'string','fileSize?':'number'}],'documentIds?':['string']},
'resident-wishlist':{'action?':{'union':['"LIST"','"TOGGLE"']},'societyUserId':'string','marketplaceItemId?':'number','page?':'number','limit?':'number'},
'process-csv-import':{'file':'binary CSV file','page?':'number','limit?':'number','entityType?':'string','status?':'string','searchQuery?':'string'},
'razorpay-webhook':{'event':'string','payload':{'payment?':{'entity':{'id':'string','order_id':'string','notes?':'object'}}}},
'send-notification':{'record':{'notification_id':'string','recipient_id':'string','recipient_type':'string','title?':'string','message?':'string','notification_type?':'string','navigation_screen?':'string','reference_id?':'string','reference_table?':'string'}},
'send-sos-push':{'sosId':'string'},
'search-contacts':{'searchKey':'string','registrationNumber':'string','page?':'number','limit?':'number'},
'verify-payment':{'societyRegistrationNumber':'string','paymentId':'string','action':{'union':['"VERIFY"','"REJECT"']},'rejectionReason?':'string','receiptImage?':'binary file (multipart only)'},
'update-approval-status':{'actionType':{'union':['"SendForApproval"','"Approved"','"Reject"']},'societyRegistrationNumber':'string','visitorId':'string','page?':'number','limit?':'number','filters?':'object'},
'update-residents-profile':{'operation?':{'union':['"UPDATE"','"FETCH"']},'societyRegistrationNumber':'string','residentId?':'string','role?':'string','page?':'number','limit?':'number','search?':'string','filterRole?':'string','filterStatus?':'boolean','filterUserType?':'string','filterUserOwnershipType?':'string','filterTower?':'string','filterBlock?':'string',**{k+'?':'string | null' for k in ['name','description','gender','occupation','idProofType','idProofNumber','vehicleType','vehicleRegNo','parkingSlot','parking_slot','email','phone','whatsAppPhone','emergencyPhone','flatNumber','userType','userOwnershipType','moveInDate','moveOutDate','block','tower','flatTypeId','flatType']},'status?':'boolean'},
'vendor-management':{'operation':{'union':['"CREATE"','"FETCH"','"UPDATE"','"DELETE"']},'societyRegistrationNumber':'string',**{k+'?':'string' for k in ['recordId','vendorId','name','phoneNumber','email','gender','role','serviceType','idProofType','idProofNumber','vehicleNumber','vehicleType','search']},'vendorRating?':'number','page?':'number','limit?':'number'},
}
root_interfaces={'verify-booking-facility':'VerifyBookingPayload','generate-payment-receipt':'DownloadRequest','save-fcm-token':'Req','switch-user':'SwitchRequestBody','get-payments-list':'GetPaymentsPayload','security-gate-console':'SecurityGatePayload','visitor-pass-operations':'UnifiedSecurityPayload','security-guard-image':'SecurityGuardImagePayload'}
query_overrides={'get-societies':['page','limit','society_name','registration_number','subscription_plan'],'get-subscription-info':['action','page','limit']}
conditionals={
'add-members':['memberData[] requires fullName, phone, idProofType and idProofNumber. Other role-specific fields depend on memberType.'],
'crud-block':['CREATE: payload.block_name or payload.blockName. UPDATE: blockId and at least one valid payload field. DELETE: blockId.'],
'crud-tower':['CREATE: payload.name and payload.active. UPDATE: towerId and nonempty payload. DELETE: towerId.'],
'crud-flat-type':['CREATE: payload.flatType. UPDATE: flatTypeId and nonempty payload. DELETE: flatTypeId.'],
'crud-society-staff':['CREATE: payload.name, payload.phone, payload.role. UPDATE: staffId and nonempty payload. DELETE: staffId.'],
'crud-society':['UPDATE: nonempty payload.'],
'crud-facility':['CREATE: payload.name and payload.type. UPDATE: id and at least one editable/image field. DELETE: id. Maximum five active facility images.'],
'crud-notice':['CREATE: noticeData.title and noticeData.message. UPDATE: noticeId or noticeData.noticeId and at least one editable field. DELETE: noticeId or noticeData.noticeId.'],
'crud-servant':['CREATE: servantData.name, phoneNumber, idProofType and idProofNumber. UPDATE: servantId (or servantData.servantId) and servantData/servantImage changes. DELETE: servantId.'],
'crud-family':['CREATE: memberName, memberPhone, idProofType, idProofNumber, relationship. UPDATE/DELETE/RESTORE/CHANGE_PRIMARY: targetResidentId. UPDATE requires an editable field. Flat-type fields are optional; omitted on UPDATE preserves assignment.'],
'crud-pre-approved-visitor':['CREATE: visitorData.name, phoneNumber and purpose; recurringDays when isRecurring. UPDATE/DELETE: visitorId.'],
'crud-resident-complaint':['CREATE: complaintData.title and description. UPDATE: complaintId and editable complaint/image fields.'],
'crud-document':['UPLOAD request phase: payload.documentTitle, category, fileName, fileType. Confirm phase: documentId and payload.objectKey. DOWNLOAD/DELETE: documentId.'],
'crud-resident-document':['UPLOAD request phase: payload.documentType, fileName, fileType. Confirm: documentId and payload.objectKey. DOWNLOAD/DELETE: documentId; shared documents are read-only.'],
'generate-payment-receipt':['Download: paymentId; responseFormat defaults to file. List mode: list:true, with optional filters and pagination.'],
'facility-console':['FETCH_SCHEDULE: bookingDate and facilityName or facilityType. FETCH_MY_BOOKINGS uses the authenticated caller.'],
'facility-booking-action':['Reject: reasonForRejecting.'],
'facility-booking-admin':['VERIFY_PAYMENT: payId and approvalStatus; rejection reason when rejected. UPDATE_STATUS: bookingId and action; reasonForRejecting when rejecting.'],
'admin-payments-console':['VERIFY_PAYMENT: paymentId and action; rejectionReason when action is REJECT.'],
'resident-payments-console':['SUBMIT_PAYMENT and CONFIRM_RECEIPT_UPLOAD: paymentId; fileName/fileType/fileSize describe optional receipt upload. FETCH_OWN uses caller context.'],
'marketplace-browse':['BROWSE: registrationNumber or societyRegistrationNumber. TOGGLE_WISHLIST: marketplaceItemId.'],
'resident-marketplace-console':['CREATE: title, category and price unless priceType=Free. UPDATE/ADD_IMAGES/DELETE_IMAGES/DELETE: marketPlaceId. ADD_IMAGES requires files; DELETE_IMAGES requires documentIds.'],
'resident-marketplace':['Mutation/image operations: marketPlaceId; image upload files or image deletion documentIds.'],
'manage-complaint-admin':['ASSIGN: complaintId and staffId. STAFF_LIST and VIEW use caller society.'],
'manage-resident-servants':['DETAIL/HIRE/LAYOFF: servantId. HIRE: roles; recurringDays when isRecurring.'],
'manage-servant-hire':['hire: roles; recurringDays when isRecurring=true.'],
'staff-complaints':['UPDATE: complaintId and newStatus. UPDATE_AVAILABILITY: agentAvailabilityStatus.'],
'staff-complaint-images':['UPLOAD: complaintId, documentType (BEFORE/AFTER), files. DELETE: documentId.'],
'staff-complaint-workflow':['Image actions: complaintId, imageType/files or documentId as appropriate. OTP verification: complaintId and otp. FETCH_OTP: complaintId and stage.'],
'resident-profile-console':['FETCH_ONE/UPDATE: residentId. UPDATE requires at least one editable field. actionType may be resolved from the supported operation alias.'],
'update-residents-profile':['UPDATE: residentId and editable fields. FETCH: residentId is not required.'],
'security-gate-console':['REQUEST_APPROVAL: societyUserId and visitorName plus phone/phoneNumber, or a verified OTP visitorId. UPDATE_STATUS: visitorId and newStatus.'],
'visitor-pass-operations':['Provide actionType or operation. Visitor approval/status: societyUserId/visitorId and appropriate name/phone/status data. Flat lookups: flatNumber. Servant status: societyServantId and newStatus. UPLOAD: societyRegistrationNumber, visitorId, fileName, fileType. CONFIRM_UPLOAD: visitorId, documentId/objectKey from upload. FETCH: documentId.'],
'security-guard-image':['UPLOAD: societyRegistrationNumber, visitorId, fileName, fileType; optional fileBase64. FETCH: documentId.'],
'save-fcm-token':['REGISTER: fcmToken; role for society_user. REMOVE: fcmToken. REMOVE_ALL: token not required.'],
'manage-transfer':['REQUEST: transferType and destination fields appropriate to SOCIETY/MEMBER/GIFT. ACCEPT/CANCEL: transferId.'],
'manage-subscription-payment':['UPGRADE: newPlanCode.'],
'request-refund':['REQUEST for a prorated refund: reason of at least 10 characters.'],
'vendor-management':['CREATE: name, phoneNumber, role. UPDATE/DELETE: recordId.'],
'visitor-otp':['Verification: otp (six digits), optional visitorId. Generate accepts optional visitorName/name.'],
'process-csv-import':['file is multipart CSV. CSV rows require entity_type, name, phone and entity-specific fields; filters apply to the report.'],
'switch-user':['phoneNumber, registrationNumber and role are required at runtime.'],
'get-payments-list':['societyRegistrationNumber is required at runtime.'],
'get-facility-schedule':['facilityName or facilityType is required.'],
}
# More precise examples for action-specific required fields. Other optional fields are documented separately.
action_fields={
'crud-block':{'CREATE':{'payload':{'blockName':'Block A','active':True}},'UPDATE':{'blockId':'<BLOCK_UUID>','payload':{'active':False}},'DELETE':{'blockId':'<BLOCK_UUID>'}},
'crud-tower':{'CREATE':{'payload':{'name':'Tower A','active':True,'floors':10,'flats_per_floor':4}},'UPDATE':{'towerId':'<TOWER_UUID>','payload':{'name':'Tower A'}},'DELETE':{'towerId':'<TOWER_UUID>'}},
'crud-flat-type':{'CREATE':{'payload':{'flatType':'<CATALOG_FLAT_TYPE>','maintenanceCharges':1500}},'UPDATE':{'flatTypeId':'<SOCIETY_FLAT_TYPE_UUID>','payload':{'maintenanceCharges':2000}},'DELETE':{'flatTypeId':'<SOCIETY_FLAT_TYPE_UUID>'}},
'crud-society-staff':{'CREATE':{'payload':{'name':'Staff Example','phone':'9000000000','role':'<STAFF_ROLE>'}},'UPDATE':{'staffId':'<STAFF_UUID>','payload':{'name':'Updated Staff'}},'DELETE':{'staffId':'<STAFF_UUID>'}},
'crud-society':{'UPDATE':{'payload':{'societyName':'Example Society'}}},
'crud-facility':{'CREATE':{'payload':{'name':'Community Hall','type':'<FACILITY_TYPE>','isChargeable':False}},'UPDATE':{'id':'<FACILITY_UUID>','payload':{'description':'Updated description'}},'DELETE':{'id':'<FACILITY_UUID>'}},
'crud-notice':{'CREATE':{'noticeData':{'title':'Notice title','message':'Notice message','targetAudience':['both']}},'UPDATE':{'noticeId':'<NOTICE_UUID>','noticeData':{'title':'Updated notice'}},'DELETE':{'noticeId':'<NOTICE_UUID>'}},
'crud-servant':{'CREATE':{'servantData':{'name':'Example Servant','phoneNumber':'9000000000','idProofType':'pan','idProofNumber':'ABCDE1234F'}},'UPDATE':{'servantId':'<SERVANT_UUID>','servantData':{'status':'inactive'}},'DELETE':{'servantId':'<SERVANT_UUID>'}},
'crud-family':{'CREATE':{'memberName':'Example Family Member','memberPhone':'9000000000','idProofType':'PAN','idProofNumber':'ABCDE1234F','relationship':'Brother','flatTypeId':'<ACTIVE_SOCIETY_FLAT_TYPE_UUID>'},'UPDATE':{'targetResidentId':'<RESIDENT_UUID>','memberName':'Updated Member'},'DELETE':{'targetResidentId':'<RESIDENT_UUID>'},'RESTORE':{'targetResidentId':'<RESIDENT_UUID>'},'CHANGE_PRIMARY':{'targetResidentId':'<RESIDENT_UUID>'}},
'crud-pre-approved-visitor':{'CREATE':{'visitorData':{'name':'Example Visitor','phoneNumber':'9000000000','purpose':'Guest'}},'UPDATE':{'visitorId':'<VISITOR_UUID>','visitorData':{'purpose':'Updated visit'}},'DELETE':{'visitorId':'<VISITOR_UUID>'}},
'crud-resident-complaint':{'CREATE':{'complaintData':{'title':'Water leak','description':'Leak in kitchen','complaintType':'plumbing'}},'UPDATE':{'complaintId':'<COMPLAINT_UUID>','complaintData':{'description':'Updated details'}}},
'crud-document':{'UPLOAD':{'phase':'request','payload':{'documentTitle':'Society Rules','category':'society_rules','fileName':'rules.pdf','fileType':'application/pdf'}},'DOWNLOAD':{'documentId':'<DOCUMENT_UUID>'},'DELETE':{'documentId':'<DOCUMENT_UUID>'}},
'crud-resident-document':{'UPLOAD':{'phase':'request','payload':{'documentType':'pan_card','fileName':'pan.pdf','fileType':'application/pdf'}},'DOWNLOAD':{'documentId':'<DOCUMENT_UUID>'},'DELETE':{'documentId':'<DOCUMENT_UUID>'}},
'facility-console':{'FETCH_SCHEDULE':{'facilityName':'<FACILITY_NAME>','bookingDate':'2026-12-01'}},
'facility-booking-admin':{'VERIFY_PAYMENT':{'payId':'<PAYMENT_UUID>','approvalStatus':'Approved'},'UPDATE_STATUS':{'bookingId':'<BOOKING_ID>','action':'Approve'}},
'admin-payments-console':{'VERIFY_PAYMENT':{'paymentId':'<PAYMENT_UUID>','action':'VERIFY'}},
'manage-complaint-admin':{'ASSIGN':{'complaintId':'<COMPLAINT_UUID>','staffId':'<STAFF_UUID>'}},
'manage-resident-servants':{'DETAIL':{'servantId':'<SERVANT_UUID>'},'HIRE':{'servantId':'<SERVANT_UUID>','roles':['cook'],'isRecurring':False},'LAYOFF':{'servantId':'<SERVANT_UUID>'}},
'marketplace-browse':{'BROWSE':{'registrationNumber':'<SOCIETY_REGISTRATION_NUMBER>'},'TOGGLE_WISHLIST':{'marketplaceItemId':1}},
'resident-profile-console':{'FETCH_ONE':{'residentId':'<RESIDENT_UUID>'},'UPDATE':{'residentId':'<RESIDENT_UUID>','name':'Updated Resident','flatTypeId':'<ACTIVE_SOCIETY_FLAT_TYPE_UUID>'}},
'update-residents-profile':{'UPDATE':{'residentId':'<RESIDENT_UUID>','name':'Updated Resident','flatTypeId':'<ACTIVE_SOCIETY_FLAT_TYPE_UUID>'}},
'vendor-management':{'CREATE':{'name':'Example Vendor','phoneNumber':'9000000000','role':'vendor'},'UPDATE':{'recordId':'<VENDOR_RECORD_UUID>','name':'Updated Vendor'},'DELETE':{'recordId':'<VENDOR_RECORD_UUID>'}},
'resident-marketplace-console':{'CREATE':{'title':'Used chair','category':'<MARKETPLACE_CATEGORY>','priceType':'Free','files':[{'fileName':'chair.jpg','fileType':'image/jpeg'}]},'UPDATE':{'marketPlaceId':1,'title':'Updated chair'},'ADD_IMAGES':{'marketPlaceId':1,'files':[{'fileName':'chair.jpg','fileType':'image/jpeg'}]},'DELETE_IMAGES':{'marketPlaceId':1,'documentIds':['<DOCUMENT_UUID>']},'DELETE':{'marketPlaceId':1}},
'resident-payments-console':{'SUBMIT_PAYMENT':{'paymentId':'<PAYMENT_UUID>','fileName':'receipt.jpg','fileType':'image/jpeg'},'CONFIRM_RECEIPT_UPLOAD':{'paymentId':'<PAYMENT_UUID>'}},
'staff-complaints':{'UPDATE':{'complaintId':'<COMPLAINT_UUID>','newStatus':'<ALLOWED_COMPLAINT_STATUS>'},'UPDATE_AVAILABILITY':{'agentAvailabilityStatus':'<AVAILABILITY_STATUS>'}},
'staff-complaint-workflow':{'FETCH_OTP':{'complaintId':'<COMPLAINT_UUID>','stage':'START'},'UPLOAD_IMAGE':{'complaintId':'<COMPLAINT_UUID>','imageType':'BEFORE','files':[{'fileName':'before.jpg','fileType':'image/jpeg'}]},'FETCH_IMAGE':{'complaintId':'<COMPLAINT_UUID>','imageType':'BEFORE'},'DELETE_IMAGE':{'documentId':'<DOCUMENT_UUID>'},'START_OTP':{'complaintId':'<COMPLAINT_UUID>'},'VERIFY_START':{'complaintId':'<COMPLAINT_UUID>','otp':'<6_DIGIT_OTP>'},'END_OTP':{'complaintId':'<COMPLAINT_UUID>'},'VERIFY_END':{'complaintId':'<COMPLAINT_UUID>','otp':'<6_DIGIT_OTP>'}},
'manage-transfer':{'REQUEST':{'transferType':'MEMBER','toSocietyUser':'<TARGET_SOCIETY_USER_UUID>'},'ACCEPT':{'transferId':'<TRANSFER_UUID>'},'CANCEL':{'transferId':'<TRANSFER_UUID>'}},
'manage-subscription-payment':{'UPGRADE':{'newPlanCode':'<PLAN_CODE>'}},
'request-refund':{'REQUEST':{'reason':'Request refund for eligible subscription payment'}},
'security-guard-image':{'UPLOAD':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','visitorId':'<VISITOR_UUID>','fileName':'visitor.jpg','fileType':'image/jpeg'},'FETCH':{'documentId':'<DOCUMENT_UUID>'}},
'security-gate-console':{'REQUEST_APPROVAL':{'societyUserId':'<HOST_SOCIETY_USER_UUID>','visitorName':'Example Visitor','phone':'9000000000','purpose':'Guest'},'UPDATE_STATUS':{'visitorId':'<VISITOR_UUID>','newStatus':'<ALLOWED_VISITOR_STATUS>'}},
'visitor-pass-operations':{'FETCH_PRE_APPROVALS':{},'REQUEST_APPROVAL':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','societyUserId':'<HOST_SOCIETY_USER_UUID>','visitorId':'<VERIFIED_OTP_VISITOR_UUID>','visitorName':'Example Visitor','phone':'9000000000','purpose':'Guest'},'UPDATE_STATUS':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','visitorId':'<VISITOR_UUID>','newStatus':'<ALLOWED_VISITOR_STATUS>'},'FETCH_INSIDE_LOGS':{},'FETCH_RESIDENTS_BY_FLAT':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','flatNumber':'101'},'FETCH_SERVANTS_BY_FLAT':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','flatNumber':'101'},'UPDATE_SERVANT_STATUS':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','societyServantId':'<SOCIETY_SERVANT_UUID>','newStatus':'<ALLOWED_STATUS>'},'UPLOAD':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','visitorId':'<VISITOR_UUID>','fileName':'visitor.jpg','fileType':'image/jpeg'},'CONFIRM_UPLOAD':{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','visitorId':'<VISITOR_UUID>','documentId':'<DOCUMENT_UUID>','objectKey':'<UPLOAD_OBJECT_KEY>'},'FETCH':{'documentId':'<DOCUMENT_UUID>'},'FETCH_ALL':{}},
'save-fcm-token':{'REGISTER':{'fcmToken':'<FCM_TOKEN>','userType':'society_user','role':'resident','deviceType':'android'},'REMOVE':{'fcmToken':'<FCM_TOKEN>'}},
}
# Compatibility aliases are replaced by real current routes without inventing live endpoints.
legacy={
'create-notice':('crud-notice','CREATE'),'get-notices':('crud-notice','VIEW'),'update-notice':('crud-notice','UPDATE'),'delete-notice':('crud-notice','DELETE'),
'get-servants':('crud-servant','VIEW'),'add-servant':('crud-servant','CREATE'),'update-servant':('crud-servant','UPDATE'),'delete-servant':('crud-servant','DELETE'),
'create-pre-approved-visitor':('crud-pre-approved-visitor','CREATE'),'delete-pre-approved-visitor':('crud-pre-approved-visitor','DELETE'),'get-pre-approved-visitors':('crud-pre-approved-visitor','VIEW'),'update-pre-approved-visitor':('crud-pre-approved-visitor','UPDATE'),
'family-manager':('crud-family',None),'family-view':('crud-family','VIEW'),'download-receipt':('generate-payment-receipt',None)}
manual['get-pending-approvals']['type?']={'union':['"ALL"','"COMPLAINTS"','"BOOKINGS"']}
def resolve_type(value,c,depth=0):
 if depth>7:return value
 if isinstance(value,str) and value in c['interfaces']:return resolve_type(c['interfaces'][value],c,depth+1)
 if isinstance(value,str) and value in c['types']:return resolve_type(c['types'][value],c,depth+1)
 if isinstance(value,str) and value.startswith('typeof '):
  key=value.split()[1].split('[')[0]
  if c['enums'].get(key):return {'union':[json.dumps(x) for x in c['enums'][key]]}
 if isinstance(value,list):return [resolve_type(x,c,depth+1) for x in value]
 if isinstance(value,dict):return {k:resolve_type(v,c,depth+1) for k,v in value.items()}
 return value

def get_schema(n):
 c=contracts[n]
 if n in manual:return manual[n]
 chosen=root_interfaces.get(n)
 if not chosen:
  candidates=[k for k in c['interfaces'] if re.search(r'Request|RequestBody',k) and not re.search(r'Raw|Authenticated',k)]
  chosen=candidates[0] if candidates else None
 if not chosen:raise ValueError('No reviewed request schema: '+n)
 shape=resolve_type(c['interfaces'][chosen],c)
 # Interface optionality is refined by runtime validation.
 if n=='get-payments-list':shape['societyRegistrationNumber']=shape.pop('societyRegistrationNumber?')
 if n=='switch-user':
  for k in ['phoneNumber','registrationNumber','role']:shape[k]=shape.pop(k+'?')
 return shape

def typename(t):
 if isinstance(t,list):return 'array<'+typename(t[0])+'>' if t else 'array'
 if isinstance(t,dict):return ' | '.join(map(typename,t['union'])) if 'union' in t else 'object'
 return str(t)

def field_paths(shape,prefix='',optional_parent=False):
 out=[]
 if not isinstance(shape,dict) or 'union' in shape:return out
 for key,value in shape.items():
  opt=key.endswith('?') or optional_parent;field=key.rstrip('?');p=prefix+field
  out.append((p,typename(value),opt))
  if isinstance(value,dict) and 'union' not in value:out+=field_paths(value,p+'.',opt)
  if isinstance(value,list) and value and isinstance(value[0],dict):out+=field_paths(value[0],p+'[].',opt)
 return out

def sample_value(k,t,required_only=True,depth=0):
 if depth>6:return '<VALUE>'
 if isinstance(t,dict):
  if 'union' in t:
   choices=[v for v in t['union'] if v not in ['null','undefined']]
   return sample_value(k,choices[0] if choices else 'null',required_only,depth+1)
  return {key.rstrip('?'):sample_value(key.rstrip('?'),v,required_only,depth+1) for key,v in t.items() if not required_only or not key.endswith('?')}
 if isinstance(t,list):return [sample_value(k,t[0],required_only,depth+1)] if t else []
 if t=='null':return None
 if isinstance(t,str) and t.startswith('"'):
  try:return json.loads(t)
  except ValueError:pass
 if t in ['number','number | string'] or k in ['page','limit','pageSize','fileSize','price','maintenanceCharges']:
  return 1 if k in ['page','pageSize'] else 20 if k=='limit' else 100
 if t in ['boolean','true','false']:return t!='false'
 if k in ['societyRegistrationNumber','registrationNumber']:return '<SOCIETY_REGISTRATION_NUMBER>'
 if k in ['phone','phoneNumber','memberPhone','adminPhone']:return '9000000000'
 if k=='otp':return '<6_DIGIT_OTP>'
 if k=='flatTypeId':return '<ACTIVE_SOCIETY_FLAT_TYPE_UUID>'
 if k=='flatType':return '<ACTIVE_SOCIETY_FLAT_TYPE_NAME>'
 if k.lower().endswith('id') or k in ['toSocietyUser','toSociety','toTower','toBlock']:return '<'+re.sub(r'(?<!^)(?=[A-Z])','_',k).upper()+'_UUID>'
 if k=='billingPeriod':return 'MONTHLY'
 if k=='planCode' or k=='newPlanCode':return '<PLAN_CODE>'
 if k=='memberType':return 'resident'
 if k=='role':return 'resident'
 if k=='staffType':return 'service_agent'
 if k in ['idProofType']:return 'PAN Card'
 if k in ['idProofNumber']:return 'ABCDE1234F'
 if k in ['fullName','name','memberName','visitorName']:return 'Example Person'
 if k=='email':return 'person@example.com'
 if k=='fileName':return 'example.jpg'
 if k=='fileType':return 'image/jpeg'
 if k in ['bookingDate','fromDate','toDate','startDate','endDate','moveInDate']:return '2026-12-01'
 if k in ['bookingStartDateTime']:return '2026-12-01T10:00:00+05:30'
 if k in ['bookingEndDateTime']:return '2026-12-01T11:00:00+05:30'
 if k in ['flatNumber','unitFlatNumber']:return '101'
 if k=='paymentId':return '<PAYMENT_UUID_OR_PAYMENT_ID>'
 if k=='searchKey':return 'Example'
 if k=='paymentStatus':return 'Paid'
 if k=='title':return 'Example title'
 if k=='description':return 'Example description'
 if k=='relationship':return 'Brother'
 if k=='stage':return 'START'
 if k=='event':return 'payment.captured'
 if k=='action':return '<SUPPORTED_ACTION>'
 if t=='object':return {}
 return '<'+re.sub(r'(?<!^)(?=[A-Z])','_',k).upper()+'>'

def action_values(n,shape):
 c=contracts[n];result=[]
 for key in ['actionType','action','operation']:
  t=shape.get(key,shape.get(key+'?'));vals=[]
  if isinstance(t,dict) and 'union' in t:
   vals=[json.loads(x) for x in t['union'] if isinstance(x,str) and x.startswith('"')]
  if not vals and key in shape or not vals and key+'?' in shape:
   for constant in ['VALID_ACTIONS','ALLOWED_ACTIONS','ALLOWED','validActions']:
    if c['enums'].get(constant):vals=c['enums'][constant];break
  if vals:result.extend((key,x) for x in vals)
 if n=='generate-payment-receipt':return [('list',True),('responseFormat','file'),('responseFormat','url')]
 if n=='facility-booking-action':return [('action','approve'),('action','reject')]
 if n=='resident-facility-booking':return [('action',x) for x in ['list_facilities','get_blocked_slots','book','list_bookings','cancel_booking','abort_pending_booking']]
 if n=='resident-marketplace':return [('operation',x) for x in ['FETCH','UPDATE','ADD_IMAGES','DELETE_IMAGES','DELETE']]
 return result

def examples(n,shape,only_action=None):
 base={k:sample_value(k,t) for k,t in shape.items() if not k.endswith('?') and k not in ['action','actionType','operation']}
 acts=action_values(n,shape)
 if only_action:acts=[x for x in acts if x[1]==only_action] or [('action',only_action)]
 if not acts:
  body=base
  if n=='add-members':body['memberData'][0]['flatTypeId']='<ACTIVE_SOCIETY_FLAT_TYPE_UUID>';body['memberData'][0]['parkingSlot']='P-101'
  if n=='update-member':body['updatedData']={'fullName':'Updated Resident','flatTypeId':'<ACTIVE_SOCIETY_FLAT_TYPE_UUID>','parkingSlot':'P-101'}
  if n=='get-facility-schedule':body['facilityName']='<FACILITY_NAME>'
  if n=='create-marketplace':body['priceType']='Free'
  if n=='send-notification':body['record'].update({'recipient_type':'Resident','title':'Example notification','message':'Example message'})
  if n=='razorpay-webhook':body={'event':'payment.captured','payload':{'payment':{'entity':{'id':'pay_EXAMPLE','order_id':'order_EXAMPLE','notes':{'society_user_id':'<SOCIETY_USER_UUID>'}}}}}
  return [('REQUEST',body)]
 result=[]
 for key,act in acts:
  b=copy.deepcopy(base);b[key]=act;b.update(action_fields.get(n,{}).get(act,{}))
  if n=='generate-payment-receipt':
   b={'list':True,'pagination':{'page':1,'pageSize':20}} if key=='list' else {'paymentId':'<PAYMENT_UUID_OR_PAYMENT_ID>','responseFormat':act}
  if n=='facility-booking-action':
   if act=='reject':b['reasonForRejecting']='Example rejection reason'
  if n=='resident-facility-booking':
   if act in ['book','get_blocked_slots']:b.update({'facilityName':'<FACILITY_NAME>','bookingStartDateTime':'2026-12-01T10:00:00+05:30'})
   if act=='book':b.update({'bookingEndDateTime':'2026-12-01T11:00:00+05:30','paymentMode':'<PAYMENT_MODE>'})
   if act in ['cancel_booking','abort_pending_booking']:b['bookingRequestId']='<BOOKING_REQUEST_UUID>'
  if n=='resident-marketplace':
   if act=='CREATE':b.update({'title':'Used chair','category':'<CATEGORY>','priceType':'Free'})
   if act in ['UPDATE','ADD_IMAGES','DELETE_IMAGES','DELETE']:b['marketPlaceId']=1
   if act=='UPDATE':b['title']='Updated chair'
   if act=='ADD_IMAGES':b['files']=[{'fileName':'chair.jpg','fileType':'image/jpeg'}]
   if act=='DELETE_IMAGES':b['documentIds']=['<DOCUMENT_UUID>']
  if n=='manage-servant-hire' and act=='hire':b['roles']=['cook']
  if n=='visitor-pass-operations' and key=='actionType' and act in ['FETCH_PRE_APPROVALS','FETCH_INSIDE_LOGS']:b['societyRegistrationNumber']='<SOCIETY_REGISTRATION_NUMBER>'
  result.append((('LIST' if act is True else str(act)),b))
 if n in ['crud-document','crud-resident-document']:
  confirm={**base,'action':'UPLOAD','phase':'confirm','documentId':'<DOCUMENT_UUID_FROM_REQUEST_PHASE>','payload':{'objectKey':'<OBJECT_KEY_FROM_REQUEST_PHASE>'}}
  result.append(('UPLOAD confirm after binary upload',confirm))
 return result

def get_auth(n):
 c=contracts[n];gateway=deployed[n]['verify_jwt'];code=(AUDIT/'source'/f'{n}.ts').read_text()
 if n=='razorpay-webhook':return 'Provider signature required; no JWT. Verify x-razorpay-signature against raw request body.'
 if n=='cleanup-fcm-tokens':return 'Gateway Bearer JWT; x-cron-secret (or matching bearer secret) checked when CRON_SECRET is configured.'
 if n=='get-societies':return 'Optional Bearer JWT for listing; required for /me.'
 if n=='get-subscription-info':return 'Bearer JWT required by deployed gateway. Handler additionally requires user context for myPlan/history.'
 if c['auth'] and any('middleware' in a or 'JWT verification' in a for a in c['auth']):return 'Yes — Authorization: Bearer <JWT_TOKEN>; role/society checks apply.'
 if 'Society admin credentials in body' in c['auth']:
  return ('Bearer JWT (gateway) plus ' if gateway else '')+('registrationNumber + adminPhone' if n=='crud-facility' else 'societyRegistrationNumber + adminId')+'; admin must belong to society.'
 if n=='get-picklists':return 'Body membership check: societyRegistrationNumber + active requesterId. No function-level bearer verification.'
 if n=='crud-resident-document':return 'Gateway Bearer JWT plus societyRegistrationNumber/residentId ownership checks.'
 if n=='update-parking-occupancy':return 'Gateway Bearer JWT plus security memberId validation in selected society.'
 if n in ['send-notification','send-sos-push']:return 'Internal webhook/dispatch endpoint; no function-level Bearer verification. Restrict invocation to configured backend workflow.'
 return 'Bearer JWT required by deployed gateway.' if gateway else 'No function-level Bearer verification; body context/validation applies.'

def enum_text(n,shape):
 c=contracts[n];items=[]
 for p,t,opt in field_paths(shape):
  if '"' in t:items.append(p+': '+t)
 for k,v in c['enums'].items():
  if v and re.search(r'VALID_|ALLOWED|_VALUES|validPeriods|validTypes',k) and not k.startswith('STAFF_'):
   items.append(k+': '+', '.join(map(str,v)))
 if n in ['crud-block','crud-tower']:items.append('filters.active: omitted/null/empty/all = both statuses; true/active = active only; false/inactive = inactive only.')
 if n=='create-razorpay-order':items.append('billingPeriod input is normalized case-insensitively; supported values: MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY, THREE_YEAR.')
 if n in ['renew-subscription','upgrade-subscription','manage-subscription-payment']:items.append('billingPeriod: MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY, THREE_YEAR.')
 if n=='get-subscription-info':items.append('action query: plans, myPlan, history.')
 if n=='get-pending-approvals':items.append('type: ALL, COMPLAINTS, BOOKINGS.')
 if n=='complaint-otp':items.append('stage: START, END.')
 if n in ['get-payments-list','get-facility-bookings','view-resident-payments','resident-payments-console']:items.append('Status filters follow normalized ledger/booking values; do not substitute numeric booleans.')
 if any('PICKLIST' in k for k in c['enums']) or n=='crud-flat-type':items.append('Dynamic option labels come from SSP_Picklist_Config/get-picklists. Society flat-type assignment requires an active SSP_Flat_Type row in the same society.')
 return '\n'.join(dict.fromkeys(items)) or 'No closed request enum declared; free-text values are validated by the handler/database where applicable.'

response_notes={
'get-society-settings':'200: {status:"SUCCESS", data:{society,towers,blocks,staff,flatTypes,facilities,societyConfiguration,configurationVersion}}. data.blocks includes active:true and active:false. data.flatTypes and societyConfiguration.flatTypes include active society types only.',
'get-picklists':'200 includes picklistsByTable, societyConfiguration:{towers,blocks,flatTypes}, flatTypeCatalog, configurationVersion and version. Response headers: ETag; Cache-Control: private, no-cache, must-revalidate. Matching If-None-Match returns 304 with no body. All society blocks are included; only active society flat types are configured options.',
'crud-flat-type':'DELETE 200: {status:"SUCCESS",data:{flatTypeId,active:false,clearedAssignments,message}}. CREATE/UPDATE return flatTypeId, flatType, active, maintenanceCharges, createdAt and operation message. VIEW returns data.flatTypes and pagination; inactive rows are excluded. Global catalog is preserved.',
'generate-payment-receipt':'Default download: HTTP 200 application/pdf with attachment filename; response is binary, not JSON. responseFormat:"url": JSON receipt download metadata with signed URL, file name and source. list:true: JSON list of eligible paid payments and pagination. Error response remains JSON.',
'get-dashboard':'200 uses the existing dashboard wrapper with user, society and role summaries. Society statistics totalParking/occupiedParking/vacantParking are separate from twoWheelers/fourWheelers; user.parkingSlot reads SSP_Contact.parking_slot.',
'process-csv-import':'Multipart CSV import report: successfulRows/failedRows and report pagination/filter/count metadata according to source. Row errors include rowNumber, entityType/data and reason; successful society-user rows can include parkingSlot. Uploaded CSV is data input, not JSON.',
}
flat_response={
'add-members':'data.memberCreated[]','update-member':'data.updatedMember.updatedData','get-members':'data.members[]','get-residents-profile':'profile[].residentialInformation (existing profile wrapper)','resident-profile-console':'profile.residentialInformation, residents[] or profileUpdate within existing success wrapper','update-residents-profile':'data.residents[] or profileUpdate','crud-family':'data.familyMembers[] / data.familyUpdate','search-resident':'each returned resident','get-profile':'societyUser','delete-members':'data.deletedMember for society users'}

def responses(n):
 c=contracts[n];notes=[]
 if n in response_notes:notes.append(response_notes[n])
 if n in flat_response:notes.append('Resident flat-type additions at '+flat_response[n]+': flatTypeId:string|null and flatType:string|null. Existing fields remain. Omitted update inputs preserve assignment; explicit null clears it. Current parkingSlot behavior is retained.')
 code=(AUDIT/'source'/f'{n}.ts').read_text()
 if '"../_shared/response.ts"' in code and 'successResponse' in code:notes.append('Shared successResponse wrapper: {success:true,data:<payload>}.')
 # Exact source expressions avoid claiming that unexecuted examples are live responses.
 templates=[]
 for template in c['response']:
  if re.search(r'errorResponse|success:\s*false|status:\s*"FAILURE"|error:\s*',template):continue
  if template not in templates:templates.append(template)
 # Return builders describe rows and payloads when the outer response uses a variable.
 builders=[x for x in c['returnObjects'] if re.search(r'format|buildProfile|build.*Response',x['function'],re.I)]
 snippets=[]
 for x in builders[:2]:snippets.append(x['function']+' => '+x['value'])
 for x in c.get('collectionObjects',[])[:2]:snippets.append('Array item '+x['collection']+' => '+x['value'])
 response_types={k:v for k,v in c['interfaces'].items() if re.search(r'Response$|^Formatted|^BookingData$|Approval$',k) and not k.startswith('Delete')}
 if response_types:notes.append('Declared response/item fields (TypeScript notation, ? means optional):\n'+json.dumps(response_types,indent=2,ensure_ascii=False)[:10000])
 snippets+=templates[:10]
 if snippets:notes.append('Source-derived response templates (identifiers/expressions are runtime values, not live samples):\n'+'\n\n'.join(snippets))
 if not snippets and not notes:notes.append('Uses the payload returned by the source handler; see the source path and function interface definitions. No live response is asserted by this documentation audit.')
 notes.append('Errors retain the endpoint-specific error wrapper and HTTP status in source. Documentation reviewed '+DATE+'; no live mutation was executed for this workbook audit.')
 return '\n\n'.join(notes)[:30000]

def ui_module(n):
 if n in ['send-notification','send-sos-push','cleanup-fcm-tokens','razorpay-webhook']:ui='Backend / webhook / cron'
 elif n in ['get-otp','verify-otp','get-societies']:ui='All / login'
 elif n in ['search-resident','security-gate-console','security-guard-image','visitor-pass-operations','update-parking-occupancy','visitor-otp']:ui='Security / society admin'
 elif n in ['staff-complaints','staff-complaint-images','staff-complaint-workflow']:ui='Service agent / vendor'
 elif n in ['crud-block','crud-tower','crud-flat-type','crud-society','crud-society-staff','crud-document','get-society-settings','manage-complaint-admin','admin-payments-console','facility-booking-admin','delete-members','add-members','update-member','crud-facility']:ui='Society admin / authorized staff'
 elif n.startswith('resident-') or n in ['crud-family','crud-pre-approved-visitor','crud-resident-complaint','crud-resident-document','get-resident-notices','my-visitors','hired-available-servants','manage-servant-hire','manage-resident-servants','make-resident-payment','view-resident-payments','generate-payment-receipt']:ui='Resident (operation permissions apply)'
 else:ui='Authenticated / contextual caller (see Auth Required)'
 if 'subscription' in n or n in ['request-refund','manage-transfer','create-razorpay-order','verify-razorpay-payment','razorpay-webhook']:module='Subscriptions / billing'
 elif 'complaint' in n:module='Complaints'
 elif 'facility' in n or 'facilities' in n or n=='verify-booking-facility':module='Facilities / bookings'
 elif 'marketplace' in n or n=='resident-wishlist':module='Marketplace'
 elif 'servant' in n:module='Servants'
 elif 'visitor' in n or n in ['security-gate-console','security-guard-image','update-approval-status']:module='Visitors / gate operations'
 elif 'payment' in n or 'receipt' in n:module='Payments / receipts'
 elif 'document' in n:module='Documents'
 elif 'notice' in n:module='Notices'
 elif 'sos' in n:module='Emergency / SOS'
 elif 'fcm' in n or n=='send-notification':module='Notifications / devices'
 elif n in ['get-otp','verify-otp','switch-user']:module='Authentication / role context'
 elif n=='get-dashboard':module='Dashboard'
 elif 'member' in n or 'resident' in n or 'profile' in n or 'contact' in n or n=='crud-family':module='Members / resident profiles'
 else:module='Society configuration'
 return ui,module

contracts_out={}
def metadata(n,only_action=None):
 c=contracts[n];shape=get_schema(n);paths=field_paths(shape);methods=c['methods'];method=' / '.join(methods) if methods else 'POST (no explicit method guard)'
 if n in ['send-notification','cleanup-fcm-tokens']:method='POST (backend/cron invocation; handler has no non-OPTIONS method restriction)'
 required=[p+': '+t for p,t,opt in paths if not opt]
 required+=conditionals.get(n,[])
 # Include runtime-required validations not captured in interfaces.
 for v in c['validations']:
  for f in re.findall(r'validateRequired\([^,]+,\s*["\']([^"\']+)',v):
   if not any(x.startswith(f+':') for x in required):required.append(f+' (runtime validation; action-specific checks may apply)')
 optional=[p+': '+t for p,t,opt in paths if opt]
 query=query_overrides.get(n,c['query']);optional+=['URL query: '+', '.join(query)] if query else []
 if n=='generate-payment-receipt':optional+=['List mode: list:true; filters.paymentStatus/startDate/endDate/searchQuery; pagination.page/pageSize. Download: responseFormat:file|url (default file).']
 if n=='security-gate-console':optional+=['phoneNumber is accepted as a phone alias in approval workflows.']
 if n=='get-picklists':optional+=['Header If-None-Match: previous ETag/version for 304 revalidation.']
 if n in flat_response and n not in ['get-members','get-profile','get-residents-profile','search-resident','delete-members']:
  optional+=['flatTypeId / flatType are optional, validated against active configuration in the same society. Existing requests without them remain supported.']
 auth=get_auth(n);headers=['Content-Type: '+('multipart/form-data (let client set boundary)' if n=='process-csv-import' else 'application/json')]
 if 'JWT' in auth and not auth.startswith('No '):headers.append('Authorization: Bearer <JWT_TOKEN>')
 if n=='cleanup-fcm-tokens':headers.append('x-cron-secret: <CRON_SECRET> when configured')
 if n=='razorpay-webhook':headers+=['x-razorpay-signature: <PROVIDER_SIGNATURE>','x-razorpay-event-id: <PROVIDER_EVENT_ID> (optional)']
 if n=='get-picklists':headers.append('If-None-Match: <PREVIOUS_ETAG> (optional)')
 ex=examples(n,shape,only_action)
 if method.startswith('GET'):body='No JSON body. Query parameters: '+(', '.join(query) or 'none')
 elif n=='process-csv-import':body='multipart/form-data:\nfile=@<PATH_TO_CSV>\npage=1\nlimit=20\nOptional form fields: entityType, status, searchQuery.'
 else:body='Illustrative requests; replace angle-bracket placeholders with actual society/user/provider values. Optional fields are listed separately.\n\n'+'\n\n'.join(label+'\n'+json.dumps(b,indent=2,ensure_ascii=False) for label,b in ex)
 url=BASE+n
 if method.startswith('GET'):
  if n=='get-subscription-info':url+='?action=plans'
  curl='curl --request GET '+shlex.quote(url)
 else:
  curl='curl --request POST '+shlex.quote(url)
 for h in headers:
  if 'multipart/form-data' not in h and not h.startswith('If-None-Match'):curl+=' \\\n  --header '+shlex.quote(h)
 if n=='process-csv-import':curl+=" \\\n  --form 'file=@<PATH_TO_CSV>' \\\n  --form 'page=1' \\\n  --form 'limit=20'"
 elif not method.startswith('GET'):curl+=' \\\n  --data-raw '+shlex.quote(json.dumps(ex[0][1],ensure_ascii=False))
 if n=='verify-payment':body+='\n\nOptional multipart alternative: societyRegistrationNumber, paymentId, action, rejectionReason, receiptImage=@<FILE>.'
 status='Live — deployed '+deployed[n]['status']+'; version '+str(deployed[n]['version'])
 sourcebytes=(ROOT/c['file']).read_bytes();ref=c['file']+'\nSource SHA-256: '+hashlib.sha256(sourcebytes).hexdigest()+'\nDocumentation reviewed: '+DATE+'\nBasis: current local implementation + deployed inventory; no live endpoint behavior test during this audit.'
 result={'method':method,'auth':auth,'description':descriptions[n],'headers':'\n'.join(headers),'body':body,'required':'\n'.join(dict.fromkeys(required)) or 'No request-body fields. Authentication/route/query requirements are documented separately.','optional':'\n'.join(dict.fromkeys(optional)) or 'None declared.','enum':enum_text(n,shape),'status':status,'curl':curl,'date':DATE,'response':responses(n),'source':ref}
 contracts_out[n]=result
 return result

# Resolve rows and retain original IDs/ownership metadata; append missing live functions.
updated_rows=[];represented=set();aliases=[]
for sheet_index,sheet in enumerate(original):
 rows=[]
 for old in sheet[2:]:
  cells=copy.deepcopy(old['cells']);raw=cells.get('I' if sheet_index==0 else 'G','') or cells.get('G' if sheet_index==0 else 'E','');oldname=raw.strip().split()[0].strip('/')
  name,action=legacy.get(oldname,(oldname,None))
  if name not in contracts:raise ValueError('Unresolved endpoint '+oldname)
  m=metadata(name,action);represented.add(name)
  if sheet_index==0:
   cols={'method':'H','auth':'J','description':'K','headers':'L','body':'M','required':'N','optional':'O','enum':'P','status':'Q','curl':'R','date':'S','response':'T','source':'U'}
   cells['G']=name;cells['I']='/'+name
   cells['B']=cells.get('B','').strip() or 'Not recorded'
   cells['F']=cells.get('F','').strip() or 'Standalone/current endpoint'
  else:
   cols={'method':'F','auth':'H','description':'I','headers':'J','body':'K','required':'L','optional':'M','status':'O','curl':'P','date':'Q','response':'R','enum':'S','source':'T'}
   cells['E']=name;cells['G']='/'+name;cells['N']='Source reviewed '+DATE+'; live behavior not retested'
  cells['A']=cells.get('A','').strip() or f'API-S{sheet_index+1}-{old["row"]:03d}'
  for key,col in cols.items():cells[col]=m[key]
  for col in (['C','D','E'] if sheet_index==0 else ['B','C','D']):
   if not cells.get(col,'').strip():cells[col]=('Backend/internal' if name in ['send-notification','send-sos-push','cleanup-fcm-tokens','razorpay-webhook'] else 'Role/context enforced by endpoint') if col==('C' if sheet_index==0 else 'B') else name.replace('-',' ').title()
  ui,module=ui_module(name)
  cells['C' if sheet_index==0 else 'B']=ui
  cells['D' if sheet_index==0 else 'C']=module
  cells['E' if sheet_index==0 else 'D']=descriptions[name].split('. ')[0]+'.'
  if oldname!=name:
   aliases.append({'sheet':sheet_index+1,'row':old['row'],'old':oldname,'current':name,'action':action})
   desc_col='K' if sheet_index==0 else 'I';cells[desc_col]='Replaces the obsolete workbook route /'+oldname+' with /'+name+((' using action='+action) if action else '')+'. '+cells[desc_col]
  rows.append({'row':old['row'],'cells':cells,'endpoint':name})
 updated_rows.append(rows)
missing=sorted(set(contracts)-represented)
for offset,name in enumerate(missing,1):
 m=metadata(name);r=max(x['row'] for x in updated_rows[1])+1
 cells={'A':'API-CURRENT-'+str(offset).zfill(3),'B':'Backend/internal' if name=='send-notification' else 'Authenticated caller','C':'Subscription' if 'subscription' in name else 'Contacts' if name=='search-contacts' else 'Notifications' if name=='send-notification' else 'Payments','D':name.replace('-',' ').title(),'E':name,'F':m['method'],'G':'/'+name,'H':m['auth'],'I':m['description'],'J':m['headers'],'K':m['body'],'L':m['required'],'M':m['optional'],'N':'Source reviewed '+DATE+'; live behavior not retested','O':m['status'],'P':m['curl'],'Q':DATE,'R':m['response'],'S':m['enum'],'T':m['source']}
 ui,module=ui_module(name);cells['B']=ui;cells['C']=module;cells['D']=descriptions[name].split('. ')[0]+'.'
 updated_rows[1].append({'row':r,'cells':cells,'endpoint':name});represented.add(name)
assert represented==set(contracts)

# Patch only the three worksheet XML parts. This preserves styles, other sheets,
# comments, shared strings, drawings, relationships, formulas, and workbook settings.
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def colnum(col):
 n=0
 for ch in col:n=n*26+ord(ch)-64
 return n

def update_row_xml(row_xml,row_number,values,default_style='0'):
 cells={m.group(1):m.group(0) for m in re.finditer(r'<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:/>|>.*?</c>)',row_xml,re.S)}
 for col,value in values.items():
  ref=col+str(row_number);old=cells.get(ref,'');style=re.search(r'\bs="([^"]+)"',old)
  style_id = ('31' if row_number==2 else '46') if (colnum(col)>=10 or (row_number>2 and len(str(value))>100)) else (style.group(1) if style else default_style)
  style=' s="'+style_id+'"'
  # Exclude XML control characters; Excel cell maximum is 32,767 UTF-16 units.
  text=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value))
  assert len(text.encode('utf-16-le'))//2<=32767,(ref,len(text))
  cells[ref]='<c r="'+ref+'"'+style+' t="inlineStr"><is><t xml:space="preserve">'+escape(text)+'</t></is></c>'
 start=re.match(r'<row\b[^>]*>',row_xml).group(0)
 start=re.sub(r'\bspans="[^"]*"','spans="1:45"',start)
 # Keep sheet formatting and existing row height; new rows receive the template height.
 existing_noncell=re.sub(r'<c\b[^>]*(?:/>|>.*?</c>)','',row_xml[len(re.match(r'<row\b[^>]*>',row_xml).group(0)):-6],flags=re.S)
 return start+''.join(v for ref,v in sorted(cells.items(),key=lambda item:colnum(re.match('[A-Z]+',item[0]).group(0))))+existing_noncell+'</row>'

with zipfile.ZipFile(WORKBOOK) as zin:
 originals={name:zin.read(name) for name in zin.namelist()};changed={}
 for i,rows in enumerate(updated_rows,1):
  part=f'xl/worksheets/sheet{i}.xml';xml=originals[part].decode('utf-8');rowmap={int(m.group(1)):m.group(0) for m in re.finditer(r'<row\b[^>]*\br="(\d+)"[^>]*>.*?</row>',xml,re.S)}
  header={'T':'Response Structure Update','U':'Source / Audit Reference'} if i==1 else {'S':'Enumerated Values','T':'Source / Audit Reference'}
  rowmap[2]=update_row_xml(rowmap[2],2,header,'1')
  template=rowmap[original[i-1][-1]['row']]
  for row in rows:
   r=row['row']
   if r not in rowmap:
    newrow=re.sub(r'\br="\d+"',f'r="{r}"',template,count=1)
    newrow=re.sub(r'(\br="[A-Z]+)\d+(" )',lambda m:m.group(1)+str(r)+m.group(2),newrow)
    # Build a clean row from the template attributes; no old cell values are copied.
    start=re.match(r'<row\b[^>]*>',newrow).group(0)
    rowmap[r]=start+'</row>'
   rowmap[r]=update_row_xml(rowmap[r],r,row['cells'])
  xml=re.sub(r'(<sheetData>).*?(</sheetData>)',lambda m:m.group(1)+''.join(rowmap[k] for k in sorted(rowmap))+m.group(2),xml,flags=re.S)
  # Widen contract/audit columns without touching any other worksheet.
  cols_match=re.search(r'<cols>.*?</cols>',xml,re.S)
  widths={}
  if cols_match:
   for element in ET.fromstring(cols_match.group(0)):
    for column in range(int(element.get('min')),int(element.get('max'))+1):widths[column]=element.get('width','12')
  updates={10:38,11:65,12:48,13:65,14:52,15:52,16:70,17:26,18:85,19:20,20:90,21:65} if i==1 else {6:20,8:42,9:75,10:46,11:75,12:58,13:65,14:34,15:30,16:90,17:20,18:90,19:65,20:65}
  widths.update({k:str(v) for k,v in updates.items()})
  cols_xml='<cols>'+''.join(f'<col min="{k}" max="{k}" width="{v}" customWidth="1"/>' for k,v in sorted(widths.items()))+'</cols>'
  xml=xml[:cols_match.start()]+cols_xml+xml[cols_match.end():] if cols_match else xml.replace('<sheetData>',cols_xml+'<sheetData>',1)
  changed[part]=xml.encode('utf-8')
  ET.fromstring(changed[part])
 with zipfile.ZipFile(OUTPUT,'w',compression=zipfile.ZIP_DEFLATED) as zout:
  for info in zin.infolist():zout.writestr(info,changed.get(info.filename,originals[info.filename]))

# Verify package integrity and untouched workbook parts byte for byte.
with zipfile.ZipFile(OUTPUT) as z:
 assert z.testzip() is None
 untouched=[n for n in originals if n not in changed]
 assert all(z.read(n)==originals[n] for n in untouched)
 for i,rows in enumerate(updated_rows,1):
  tree=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))
  actual={c.get('r'):''.join(c.find('m:is',ns).itertext()) for c in tree.findall('m:sheetData/m:row/m:c',ns) if c.get('t')=='inlineStr'}
  for row in rows:
   for col,v in row['cells'].items():assert actual[col+str(row['row'])]==str(v),(i,row['row'],col)
report={'reviewDate':DATE,'sourceFunctionsReviewed':len(contracts),'deployedFunctions':len(deployed),'documentedCurrentFunctions':len(represented),'sheetRowsUpdated':[len(r) for r in updated_rows],'legacyRoutesReplaced':aliases,'newFunctionsAdded':missing,'modifiedPackageParts':list(changed),'untouchedPartsVerified':len(untouched),'otherSheetsUnchanged':True,'output':OUTPUT.name,'originalPreserved':True,'notes':['Contracts derived from current local sources and deployed inventory; audit does not assert live request/response execution.','API IDs and recorded developer ownership retained; missing ownership marked Not recorded.','Runtime source expressions in response templates are explicitly labeled; placeholders are not real secrets or live samples.']}
(AUDIT/'reviewed-contracts.json').write_text(json.dumps(contracts_out,ensure_ascii=False,indent=2))
(AUDIT/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
