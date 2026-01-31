/**
 * Permission constants for admin roles
 * Based on the detailed RBAC requirements
 */

export enum PermissionCategory {
	ADMIN_MANAGEMENT = 'admin_management',
	FRANCHISE_MANAGEMENT = 'franchise_management',
	TUTOR_MANAGEMENT = 'tutor_management',
	STUDENT_MANAGEMENT = 'student_management',
	FINANCE = 'finance',
	SAFETY = 'safety',
	CONTENT = 'content',
	ANALYTICS = 'analytics',
	AUDIT = 'audit',
	OPERATIONS = 'operations',
}

/**
 * Permission codes organized by category
 */
export const PERMISSIONS = {
	// Admin Management
	CREATE_STATE_ADMIN: 'admin:create:state_admin',
	UPDATE_STATE_ADMIN: 'admin:update:state_admin',
	DELETE_STATE_ADMIN: 'admin:delete:state_admin',
	CREATE_DISTRICT_ADMIN: 'admin:create:district_admin',
	UPDATE_DISTRICT_ADMIN: 'admin:update:district_admin',
	DELETE_DISTRICT_ADMIN: 'admin:delete:district_admin',
	CREATE_ZONE_ADMIN: 'admin:create:zone_admin',
	UPDATE_ZONE_ADMIN: 'admin:update:zone_admin',
	DELETE_ZONE_ADMIN: 'admin:delete:zone_admin',
	CREATE_LOCALITY_SUPERVISOR: 'admin:create:locality_supervisor',
	UPDATE_LOCALITY_SUPERVISOR: 'admin:update:locality_supervisor',
	DELETE_LOCALITY_SUPERVISOR: 'admin:delete:locality_supervisor',
	VIEW_ADMINS: 'admin:view',
	DISABLE_ADMINS: 'admin:disable',

	// Franchise Management
	CREATE_FRANCHISE: 'franchise:create',
	APPROVE_FRANCHISE: 'franchise:approve',
	UPDATE_FRANCHISE: 'franchise:update',
	DELETE_FRANCHISE: 'franchise:delete',
	SET_FRANCHISE_COMMISSION: 'franchise:set_commission',
	VIEW_FRANCHISE_PERFORMANCE: 'franchise:view_performance',
	INSPECT_FRANCHISE: 'franchise:inspect',
	CREATE_FRANCHISE_SUB_ADMIN: 'franchise:create_sub_admin',

	// Zone Management
	CREATE_ZONE: 'zone:create',
	UPDATE_ZONE: 'zone:update',
	DELETE_ZONE: 'zone:delete',
	ASSIGN_ZONE_ADMIN: 'zone:assign_admin',

	// Tutor Management
	MANAGE_TUTORS: 'tutor:manage',
	APPROVE_TUTOR: 'tutor:approve',
	REJECT_TUTOR: 'tutor:reject',
	BLOCK_TUTOR: 'tutor:block',
	ASSIGN_TUTOR_TO_STUDENT: 'tutor:assign',
	VIEW_TUTOR_ATTENDANCE: 'tutor:view_attendance',
	VIEW_TUTOR_PERFORMANCE: 'tutor:view_performance',
	UPDATE_TUTOR_DOCUMENTS: 'tutor:update_documents',
	EDIT_TUTOR_DETAILS: 'tutor:edit_details',
	ONBOARD_TUTOR: 'tutor:onboard',
	VERIFY_TUTOR_ADDRESS: 'tutor:verify_address',
	TRACK_TUTOR_ARRIVAL: 'tutor:track_arrival',

	// Student Management
	MANAGE_STUDENTS: 'student:manage',
	BLOCK_STUDENT: 'student:block',
	REMOVE_STUDENT: 'student:remove',
	VIEW_STUDENT_DETAILS: 'student:view',
	ASSIGN_STUDENT_TO_TUTOR: 'student:assign_tutor',

	// Finance
	VIEW_PLATFORM_ANALYTICS: 'finance:view_platform_analytics',
	VIEW_REVENUE: 'finance:view_revenue',
	VIEW_DISTRICT_REVENUE: 'finance:view_district_revenue',
	VIEW_ZONE_REVENUE: 'finance:view_zone_revenue',
	VIEW_FRANCHISE_REVENUE: 'finance:view_franchise_revenue',
	VIEW_FINANCIAL_DATA: 'finance:view_financial_data',
	APPROVE_FRANCHISE_PAYOUT: 'finance:approve_payout',
	SET_SESSION_FEES: 'finance:set_session_fees',
	VIEW_TAX_INVOICES: 'finance:view_tax_invoices',
	VIEW_FULL_FINANCIAL_DATA: 'finance:view_full_financial_data',

	// Safety
	VIEW_ALL_SOS_ALERTS: 'safety:view_all_sos',
	VIEW_STATE_SOS_ALERTS: 'safety:view_state_sos',
	VIEW_DISTRICT_SOS_ALERTS: 'safety:view_district_sos',
	VIEW_ZONE_SOS_ALERTS: 'safety:view_zone_sos',
	VIEW_SOS_ALERTS: 'safety:view_sos',
	REPORT_SAFETY_INCIDENT: 'safety:report_incident',
	OVERRIDE_FRANCHISE_DECISION: 'safety:override_franchise',

	// Content & Platform
	EDIT_SUBJECTS: 'content:edit_subjects',
	EDIT_CLASS_TYPES: 'content:edit_class_types',
	SET_PRICING: 'content:set_pricing',
	VIEW_CONTENT: 'content:view',

	// Analytics
	VIEW_TOTAL_STUDENTS: 'analytics:view_total_students',
	VIEW_TOTAL_TUTORS: 'analytics:view_total_tutors',
	VIEW_COMPLETED_CLASSES: 'analytics:view_completed_classes',
	VIEW_ATTENDANCE: 'analytics:view_attendance',
	VIEW_DISTRICT_PERFORMANCE: 'analytics:view_district_performance',
	VIEW_TUTOR_ACTIVITY: 'analytics:view_tutor_activity',
	VIEW_RATINGS_FEEDBACK: 'analytics:view_ratings_feedback',

	// Audit & Logs
	VIEW_SYSTEM_LOGS: 'audit:view_system_logs',
	VIEW_AUDIT_TRAIL: 'audit:view_audit_trail',
	VIEW_WHO_CHANGED_WHAT: 'audit:view_changes',

	// Operations
	APPROVE_CLASS_SCHEDULES: 'operations:approve_schedules',
	MANAGE_CLASSES: 'operations:manage_classes',
	MONITOR_ATTENDANCE: 'operations:monitor_attendance',
	VERIFY_CLASS_COMPLETION: 'operations:verify_completion',
	MARK_TUTOR_VISITS: 'operations:mark_visits',
	HANDLE_COMPLAINTS: 'operations:handle_complaints',
	HANDLE_PARENTAL_COMPLAINTS: 'operations:handle_parental_complaints',
	SOLVE_ON_GROUND_ISSUES: 'operations:solve_issues',
	SUBMIT_ATTENDANCE: 'operations:submit_attendance',
	TRACK_TUTOR_ARRIVAL_EXIT: 'operations:track_arrival_exit',
	APPROVE_STAFF_REQUESTS: 'operations:approve_staff_requests',
} as const;

/**
 * Permission definitions with metadata
 */
export type PermissionDefinition = {
	code: string;
	name: string;
	description: string;
	category: PermissionCategory;
};

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
	// Admin Management
	{
		code: PERMISSIONS.CREATE_STATE_ADMIN,
		name: 'Create State Admin',
		description: 'Create new state admin users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_STATE_ADMIN,
		name: 'Update State Admin',
		description: 'Update state admin user details',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_STATE_ADMIN,
		name: 'Delete State Admin',
		description: 'Delete state admin users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.CREATE_DISTRICT_ADMIN,
		name: 'Create District Admin',
		description: 'Create new district admin users (company or franchise)',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_DISTRICT_ADMIN,
		name: 'Update District Admin',
		description: 'Update district admin user details',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_DISTRICT_ADMIN,
		name: 'Delete District Admin',
		description: 'Delete district admin users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.CREATE_ZONE_ADMIN,
		name: 'Create Zone Admin',
		description: 'Create new zone admin users (company or franchise)',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_ZONE_ADMIN,
		name: 'Update Zone Admin',
		description: 'Update zone admin user details',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_ZONE_ADMIN,
		name: 'Delete Zone Admin',
		description: 'Delete zone admin users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.CREATE_LOCALITY_SUPERVISOR,
		name: 'Create Locality Supervisor',
		description: 'Create new locality supervisor users (company only)',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_LOCALITY_SUPERVISOR,
		name: 'Update Locality Supervisor',
		description: 'Update locality supervisor user details',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_LOCALITY_SUPERVISOR,
		name: 'Delete Locality Supervisor',
		description: 'Delete locality supervisor users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VIEW_ADMINS,
		name: 'View Admins',
		description: 'View admin users list',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DISABLE_ADMINS,
		name: 'Disable Admins',
		description: 'Disable admin users',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},

	// Franchise Management
	{
		code: PERMISSIONS.CREATE_FRANCHISE,
		name: 'Create Franchise',
		description: 'Create new franchise accounts',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.APPROVE_FRANCHISE,
		name: 'Approve Franchise',
		description: 'Approve franchise accounts',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_FRANCHISE,
		name: 'Update Franchise',
		description: 'Update franchise account details',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_FRANCHISE,
		name: 'Delete Franchise',
		description: 'Delete franchise accounts',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.SET_FRANCHISE_COMMISSION,
		name: 'Set Franchise Commission',
		description: 'Set commission percentage for franchises',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VIEW_FRANCHISE_PERFORMANCE,
		name: 'View Franchise Performance',
		description: 'View franchise performance metrics',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.INSPECT_FRANCHISE,
		name: 'Inspect Franchise',
		description: 'Inspect franchise quality and operations',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},
	{
		code: PERMISSIONS.CREATE_FRANCHISE_SUB_ADMIN,
		name: 'Create Franchise Sub Admin',
		description: 'Create franchise sub-admin accounts',
		category: PermissionCategory.FRANCHISE_MANAGEMENT,
	},

	// Zone Management
	{
		code: PERMISSIONS.CREATE_ZONE,
		name: 'Create Zone',
		description: 'Create new zones',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_ZONE,
		name: 'Update Zone',
		description: 'Update zone details',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.DELETE_ZONE,
		name: 'Delete Zone',
		description: 'Delete zones',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},
	{
		code: PERMISSIONS.ASSIGN_ZONE_ADMIN,
		name: 'Assign Zone Admin',
		description: 'Assign zone admins to zones',
		category: PermissionCategory.ADMIN_MANAGEMENT,
	},

	// Tutor Management
	{
		code: PERMISSIONS.MANAGE_TUTORS,
		name: 'Manage Tutors',
		description: 'Manage tutors in assigned area',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.APPROVE_TUTOR,
		name: 'Approve Tutor',
		description: 'Approve tutor applications',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.REJECT_TUTOR,
		name: 'Reject Tutor',
		description: 'Reject tutor applications',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.BLOCK_TUTOR,
		name: 'Block Tutor',
		description: 'Block tutors from platform',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.ASSIGN_TUTOR_TO_STUDENT,
		name: 'Assign Tutor to Student',
		description: 'Assign tutors to students',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VIEW_TUTOR_ATTENDANCE,
		name: 'View Tutor Attendance',
		description: 'View tutor attendance records',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VIEW_TUTOR_PERFORMANCE,
		name: 'View Tutor Performance',
		description: 'View tutor performance metrics',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.UPDATE_TUTOR_DOCUMENTS,
		name: 'Update Tutor Documents',
		description: 'Update tutor documents',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.EDIT_TUTOR_DETAILS,
		name: 'Edit Tutor Details',
		description: 'Edit tutor profile details',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.ONBOARD_TUTOR,
		name: 'Onboard Tutor',
		description: 'Assist with tutor onboarding',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VERIFY_TUTOR_ADDRESS,
		name: 'Verify Tutor Address',
		description: 'Verify tutor address documents',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},
	{
		code: PERMISSIONS.TRACK_TUTOR_ARRIVAL,
		name: 'Track Tutor Arrival',
		description: 'Track tutor arrival/exit',
		category: PermissionCategory.TUTOR_MANAGEMENT,
	},

	// Student Management
	{
		code: PERMISSIONS.MANAGE_STUDENTS,
		name: 'Manage Students',
		description: 'Manage students in assigned area',
		category: PermissionCategory.STUDENT_MANAGEMENT,
	},
	{
		code: PERMISSIONS.BLOCK_STUDENT,
		name: 'Block Student',
		description: 'Block students from platform',
		category: PermissionCategory.STUDENT_MANAGEMENT,
	},
	{
		code: PERMISSIONS.REMOVE_STUDENT,
		name: 'Remove Student',
		description: 'Remove students from platform',
		category: PermissionCategory.STUDENT_MANAGEMENT,
	},
	{
		code: PERMISSIONS.VIEW_STUDENT_DETAILS,
		name: 'View Student Details',
		description: 'View student profile details',
		category: PermissionCategory.STUDENT_MANAGEMENT,
	},
	{
		code: PERMISSIONS.ASSIGN_STUDENT_TO_TUTOR,
		name: 'Assign Student to Tutor',
		description: 'Assign students to tutors',
		category: PermissionCategory.STUDENT_MANAGEMENT,
	},

	// Finance
	{
		code: PERMISSIONS.VIEW_PLATFORM_ANALYTICS,
		name: 'View Platform Analytics',
		description: 'View platform-wide analytics',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_REVENUE,
		name: 'View Revenue',
		description: 'View revenue data',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_DISTRICT_REVENUE,
		name: 'View District Revenue',
		description: 'View district revenue data',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_ZONE_REVENUE,
		name: 'View Zone Revenue',
		description: 'View zone revenue data',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_FRANCHISE_REVENUE,
		name: 'View Franchise Revenue',
		description: 'View franchise revenue share',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_FINANCIAL_DATA,
		name: 'View Financial Data',
		description: 'View financial data (limited)',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.APPROVE_FRANCHISE_PAYOUT,
		name: 'Approve Franchise Payout',
		description: 'Approve franchise payouts',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.SET_SESSION_FEES,
		name: 'Set Session Fees',
		description: 'Set session fees',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_TAX_INVOICES,
		name: 'View Tax Invoices',
		description: 'View tax invoices',
		category: PermissionCategory.FINANCE,
	},
	{
		code: PERMISSIONS.VIEW_FULL_FINANCIAL_DATA,
		name: 'View Full Financial Data',
		description: 'View full financial data (no restrictions)',
		category: PermissionCategory.FINANCE,
	},

	// Safety
	{
		code: PERMISSIONS.VIEW_ALL_SOS_ALERTS,
		name: 'View All SOS Alerts',
		description: 'View all SOS alerts platform-wide',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.VIEW_STATE_SOS_ALERTS,
		name: 'View State SOS Alerts',
		description: 'View SOS alerts from all districts in state',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.VIEW_DISTRICT_SOS_ALERTS,
		name: 'View District SOS Alerts',
		description: 'View SOS alerts from all zones in district',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.VIEW_ZONE_SOS_ALERTS,
		name: 'View Zone SOS Alerts',
		description: 'View SOS alerts from zone only',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.VIEW_SOS_ALERTS,
		name: 'View SOS Alerts',
		description: 'View SOS alerts (limited access)',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.REPORT_SAFETY_INCIDENT,
		name: 'Report Safety Incident',
		description: 'Report safety incidents',
		category: PermissionCategory.SAFETY,
	},
	{
		code: PERMISSIONS.OVERRIDE_FRANCHISE_DECISION,
		name: 'Override Franchise Decision',
		description: 'Override franchise zone admin decisions',
		category: PermissionCategory.SAFETY,
	},

	// Content & Platform
	{
		code: PERMISSIONS.EDIT_SUBJECTS,
		name: 'Edit Subjects',
		description: 'Edit subjects and class types',
		category: PermissionCategory.CONTENT,
	},
	{
		code: PERMISSIONS.EDIT_CLASS_TYPES,
		name: 'Edit Class Types',
		description: 'Edit class types',
		category: PermissionCategory.CONTENT,
	},
	{
		code: PERMISSIONS.SET_PRICING,
		name: 'Set Pricing',
		description: 'Set pricing for each subject',
		category: PermissionCategory.CONTENT,
	},
	{
		code: PERMISSIONS.VIEW_CONTENT,
		name: 'View Content',
		description: 'View content and subjects',
		category: PermissionCategory.CONTENT,
	},

	// Analytics
	{
		code: PERMISSIONS.VIEW_TOTAL_STUDENTS,
		name: 'View Total Students',
		description: 'View total students count',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_TOTAL_TUTORS,
		name: 'View Total Tutors',
		description: 'View total tutors count',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_COMPLETED_CLASSES,
		name: 'View Completed Classes',
		description: 'View completed classes count',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_ATTENDANCE,
		name: 'View Attendance',
		description: 'View attendance data',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_DISTRICT_PERFORMANCE,
		name: 'View District Performance',
		description: 'View district performance metrics',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_TUTOR_ACTIVITY,
		name: 'View Tutor Activity',
		description: 'View tutor activity metrics',
		category: PermissionCategory.ANALYTICS,
	},
	{
		code: PERMISSIONS.VIEW_RATINGS_FEEDBACK,
		name: 'View Ratings & Feedback',
		description: 'View ratings and feedback',
		category: PermissionCategory.ANALYTICS,
	},

	// Audit & Logs
	{
		code: PERMISSIONS.VIEW_SYSTEM_LOGS,
		name: 'View System Logs',
		description: 'View complete system logs',
		category: PermissionCategory.AUDIT,
	},
	{
		code: PERMISSIONS.VIEW_AUDIT_TRAIL,
		name: 'View Audit Trail',
		description: 'View audit trail',
		category: PermissionCategory.AUDIT,
	},
	{
		code: PERMISSIONS.VIEW_WHO_CHANGED_WHAT,
		name: 'View Who Changed What',
		description: 'View who changed what in the system',
		category: PermissionCategory.AUDIT,
	},

	// Operations
	{
		code: PERMISSIONS.APPROVE_CLASS_SCHEDULES,
		name: 'Approve Class Schedules',
		description: 'Approve class schedules',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.MANAGE_CLASSES,
		name: 'Manage Classes',
		description: 'Manage classes in assigned area',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.MONITOR_ATTENDANCE,
		name: 'Monitor Attendance',
		description: 'Monitor attendance in assigned area',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.VERIFY_CLASS_COMPLETION,
		name: 'Verify Class Completion',
		description: 'Verify class completion via OTP',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.MARK_TUTOR_VISITS,
		name: 'Mark Tutor Visits',
		description: 'Mark tutor visits',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.HANDLE_COMPLAINTS,
		name: 'Handle Complaints',
		description: 'Handle complaints in assigned area',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.HANDLE_PARENTAL_COMPLAINTS,
		name: 'Handle Parental Complaints',
		description: 'Handle parental complaints for locality',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.SOLVE_ON_GROUND_ISSUES,
		name: 'Solve On-Ground Issues',
		description: 'Solve on-ground issues (address, timing)',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.SUBMIT_ATTENDANCE,
		name: 'Submit Attendance',
		description: 'Submit class attendance (backup mode)',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.TRACK_TUTOR_ARRIVAL_EXIT,
		name: 'Track Tutor Arrival/Exit',
		description: 'Track tutor arrival/exit',
		category: PermissionCategory.OPERATIONS,
	},
	{
		code: PERMISSIONS.APPROVE_STAFF_REQUESTS,
		name: 'Approve Staff Requests',
		description: 'Approve staff requests',
		category: PermissionCategory.OPERATIONS,
	},
];

/**
 * Role-based permission mappings
 * Defines which permissions each role has
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
	super_admin: [
		// Full access - all permissions
		...PERMISSION_DEFINITIONS.map((p) => p.code),
	],

	state_admin: [
		// Admin Management
		PERMISSIONS.CREATE_DISTRICT_ADMIN,
		PERMISSIONS.UPDATE_DISTRICT_ADMIN,
		PERMISSIONS.DELETE_DISTRICT_ADMIN,
		PERMISSIONS.VIEW_ADMINS,
		PERMISSIONS.DISABLE_ADMINS,
		PERMISSIONS.CREATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.UPDATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.DELETE_LOCALITY_SUPERVISOR,

		// Franchise Management
		PERMISSIONS.VIEW_FRANCHISE_PERFORMANCE,
		PERMISSIONS.INSPECT_FRANCHISE,

		// Tutor Management
		PERMISSIONS.MANAGE_TUTORS,
		PERMISSIONS.APPROVE_TUTOR,
		PERMISSIONS.REJECT_TUTOR,
		PERMISSIONS.VIEW_TUTOR_ATTENDANCE,
		PERMISSIONS.VIEW_TUTOR_PERFORMANCE,
		PERMISSIONS.APPROVE_STAFF_REQUESTS,

		// Student Management
		PERMISSIONS.MANAGE_STUDENTS,
		PERMISSIONS.VIEW_STUDENT_DETAILS,

		// Finance (Limited)
		PERMISSIONS.VIEW_DISTRICT_REVENUE,
		PERMISSIONS.VIEW_FINANCIAL_DATA,

		// Safety
		PERMISSIONS.VIEW_STATE_SOS_ALERTS,
		PERMISSIONS.REPORT_SAFETY_INCIDENT,

		// Analytics
		PERMISSIONS.VIEW_DISTRICT_PERFORMANCE,
		PERMISSIONS.VIEW_TUTOR_ACTIVITY,
		PERMISSIONS.VIEW_ATTENDANCE,

		// Operations
		PERMISSIONS.APPROVE_STAFF_REQUESTS,
	],

	district_admin: [
		// Admin Management
		PERMISSIONS.CREATE_ZONE_ADMIN,
		PERMISSIONS.UPDATE_ZONE_ADMIN,
		PERMISSIONS.DELETE_ZONE_ADMIN,
		PERMISSIONS.VIEW_ADMINS,
		PERMISSIONS.CREATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.UPDATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.DELETE_LOCALITY_SUPERVISOR,

		// Franchise Management (Company only)
		PERMISSIONS.CREATE_FRANCHISE_SUB_ADMIN,

		// Tutor Management
		PERMISSIONS.MANAGE_TUTORS,
		PERMISSIONS.APPROVE_TUTOR,
		PERMISSIONS.REJECT_TUTOR,
		PERMISSIONS.ASSIGN_TUTOR_TO_STUDENT,
		PERMISSIONS.VIEW_TUTOR_ATTENDANCE,
		PERMISSIONS.VIEW_TUTOR_PERFORMANCE,
		PERMISSIONS.EDIT_TUTOR_DETAILS,

		// Student Management
		PERMISSIONS.MANAGE_STUDENTS,
		PERMISSIONS.ASSIGN_STUDENT_TO_TUTOR,
		PERMISSIONS.VIEW_STUDENT_DETAILS,

		// Finance
		PERMISSIONS.VIEW_DISTRICT_REVENUE,
		PERMISSIONS.VIEW_FRANCHISE_REVENUE,
		PERMISSIONS.VIEW_FINANCIAL_DATA,
		PERMISSIONS.VIEW_FULL_FINANCIAL_DATA, // Company only

		// Safety
		PERMISSIONS.VIEW_DISTRICT_SOS_ALERTS,
		PERMISSIONS.VIEW_SOS_ALERTS,
		PERMISSIONS.REPORT_SAFETY_INCIDENT,
		PERMISSIONS.OVERRIDE_FRANCHISE_DECISION, // Company only

		// Analytics
		PERMISSIONS.VIEW_DISTRICT_PERFORMANCE,
		PERMISSIONS.VIEW_TUTOR_ACTIVITY,
		PERMISSIONS.VIEW_ATTENDANCE,
		PERMISSIONS.VIEW_RATINGS_FEEDBACK,

		// Operations
		PERMISSIONS.APPROVE_CLASS_SCHEDULES,
		PERMISSIONS.MANAGE_CLASSES,
		PERMISSIONS.HANDLE_COMPLAINTS,
	],

	zone_admin: [
		// Tutor Management
		PERMISSIONS.MANAGE_TUTORS,
		PERMISSIONS.APPROVE_TUTOR,
		PERMISSIONS.REJECT_TUTOR,
		PERMISSIONS.ASSIGN_TUTOR_TO_STUDENT,
		PERMISSIONS.VIEW_TUTOR_ATTENDANCE,
		PERMISSIONS.VIEW_TUTOR_PERFORMANCE,
		PERMISSIONS.EDIT_TUTOR_DETAILS,
		PERMISSIONS.UPDATE_TUTOR_DOCUMENTS, // Company only

		// Student Management
		PERMISSIONS.MANAGE_STUDENTS,
		PERMISSIONS.ASSIGN_STUDENT_TO_TUTOR,
		PERMISSIONS.VIEW_STUDENT_DETAILS,

		// Admin Management
		PERMISSIONS.CREATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.UPDATE_LOCALITY_SUPERVISOR,
		PERMISSIONS.DELETE_LOCALITY_SUPERVISOR,
		PERMISSIONS.VIEW_ADMINS,

		// Finance
		PERMISSIONS.VIEW_ZONE_REVENUE,
		PERMISSIONS.VIEW_FRANCHISE_REVENUE,
		PERMISSIONS.VIEW_FINANCIAL_DATA,

		// Safety
		PERMISSIONS.VIEW_ZONE_SOS_ALERTS,
		PERMISSIONS.VIEW_SOS_ALERTS,
		PERMISSIONS.REPORT_SAFETY_INCIDENT,

		// Analytics
		PERMISSIONS.VIEW_TUTOR_ACTIVITY,
		PERMISSIONS.VIEW_ATTENDANCE,
		PERMISSIONS.VIEW_RATINGS_FEEDBACK,

		// Operations
		PERMISSIONS.MANAGE_CLASSES,
		PERMISSIONS.MONITOR_ATTENDANCE,
		PERMISSIONS.HANDLE_COMPLAINTS,
		PERMISSIONS.TRACK_TUTOR_ARRIVAL_EXIT,
	],

	locality_supervisor: [
		// Tutor Management
		PERMISSIONS.MARK_TUTOR_VISITS,
		PERMISSIONS.ONBOARD_TUTOR,
		PERMISSIONS.VERIFY_TUTOR_ADDRESS,
		PERMISSIONS.TRACK_TUTOR_ARRIVAL,
		PERMISSIONS.VIEW_TUTOR_ATTENDANCE,

		// Student Management
		PERMISSIONS.VIEW_STUDENT_DETAILS,

		// Safety
		PERMISSIONS.REPORT_SAFETY_INCIDENT,

		// Operations
		PERMISSIONS.VERIFY_CLASS_COMPLETION,
		PERMISSIONS.SOLVE_ON_GROUND_ISSUES,
		PERMISSIONS.HANDLE_PARENTAL_COMPLAINTS,
		PERMISSIONS.SUBMIT_ATTENDANCE,
	],
};

/**
 * Get permissions for a role (considering admin type for district and zone admins)
 */
export function getPermissionsForRole(roleCode: string, adminType?: 'company' | 'franchise'): string[] {
	const basePermissions = ROLE_PERMISSIONS[roleCode] || [];

	// District admin - company has more permissions than franchise
	if (roleCode === 'district_admin') {
		if (adminType === 'company') {
			return [
				...basePermissions,
				PERMISSIONS.VIEW_FULL_FINANCIAL_DATA,
				PERMISSIONS.OVERRIDE_FRANCHISE_DECISION,
				PERMISSIONS.BLOCK_TUTOR,
				PERMISSIONS.BLOCK_STUDENT,
			];
		} else {
			// Franchise - remove some permissions
			return basePermissions.filter(
				(p) =>
					p !== PERMISSIONS.VIEW_FULL_FINANCIAL_DATA &&
					p !== PERMISSIONS.OVERRIDE_FRANCHISE_DECISION &&
					p !== PERMISSIONS.CREATE_FRANCHISE &&
					p !== PERMISSIONS.SET_FRANCHISE_COMMISSION
			);
		}
	}

	// Zone admin - company has more permissions than franchise
	if (roleCode === 'zone_admin') {
		if (adminType === 'company') {
			return [
				...basePermissions,
				PERMISSIONS.UPDATE_TUTOR_DOCUMENTS,
			];
		} else {
			// Franchise - remove some permissions
			return basePermissions.filter((p) => p !== PERMISSIONS.UPDATE_TUTOR_DOCUMENTS && p !== PERMISSIONS.CREATE_ZONE);
		}
	}

	return basePermissions;
}

