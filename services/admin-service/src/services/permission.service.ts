import { AppError } from '@kodingcaravan/shared';
import {
	findAdminById,
	getRolesForAdmin,
	type AdminUserRecord,
	type AdminRoleRecord,
} from '../models/adminAuth.model';
import { getPermissionsForRoles, hasAnyPermission } from '../models/permission.model';
import { PERMISSIONS } from '../constants/permissions';

export type AdminContext = {
	admin: AdminUserRecord;
	roles: AdminRoleRecord[];
	permissions: string[];
};

/**
 * Get admin context with roles and permissions
 */
export async function getAdminContext(adminId: string): Promise<AdminContext> {
	const admin = await findAdminById(adminId);
	if (!admin) {
		throw new AppError('Admin not found', 404);
	}

	const roles = await getRolesForAdmin(adminId);
	if (!roles.length) {
		throw new AppError('No roles assigned to admin', 403);
	}

	const roleIds = roles.map((role) => role.id);
	const permissions = await getPermissionsForRoles(roleIds);
	const permissionCodes = permissions.map((p) => p.code);

	return {
		admin,
		roles,
		permissions: permissionCodes,
	};
}

/**
 * Check if admin has a specific permission
 * Note: This checks permissions based on role and admin type
 */
export async function checkPermission(adminId: string, permissionCode: string): Promise<boolean> {
	const admin = await findAdminById(adminId);
	if (!admin) {
		return false;
	}

	const roles = await getRolesForAdmin(adminId);
	if (!roles.length) {
		return false;
	}

	const roleIds = roles.map((role) => role.id);
	const hasPermission = await hasAnyPermission(roleIds, permissionCode);
	
	if (!hasPermission) {
		return false;
	}

	// Apply admin type restrictions for district and zone admins
	const roleCodes = roles.map((role) => role.code);
	
	// District admin (franchise) restrictions
	if (roleCodes.includes('district_admin') && admin.adminType === 'franchise') {
		// Franchise district admins cannot:
		// - View full financial data
		// - Override franchise decisions
		// - Create new franchises
		// - Set commission rates
		const restrictedPermissions = [
			PERMISSIONS.VIEW_FULL_FINANCIAL_DATA,
			PERMISSIONS.OVERRIDE_FRANCHISE_DECISION,
			PERMISSIONS.CREATE_FRANCHISE,
			PERMISSIONS.SET_FRANCHISE_COMMISSION,
		];
		if (restrictedPermissions.includes(permissionCode as any)) {
			return false;
		}
	}

	// Zone admin (franchise) restrictions
	if (roleCodes.includes('zone_admin') && admin.adminType === 'franchise') {
		// Franchise zone admins cannot:
		// - Update tutor documents
		// - Create new zones
		const restrictedPermissions = [
			PERMISSIONS.UPDATE_TUTOR_DOCUMENTS,
			PERMISSIONS.CREATE_ZONE,
		];
		if (restrictedPermissions.includes(permissionCode as any)) {
			return false;
		}
	}

	return true;
}

/**
 * Check if admin has any of the specified permissions
 */
export async function checkAnyPermission(adminId: string, permissionCodes: string[]): Promise<boolean> {
	const roles = await getRolesForAdmin(adminId);
	if (!roles.length) {
		return false;
	}

	const roleIds = roles.map((role) => role.id);
	for (const permissionCode of permissionCodes) {
		const hasPermission = await hasAnyPermission(roleIds, permissionCode);
		if (hasPermission) {
			return true;
		}
	}
	return false;
}

/**
 * Check if admin has all of the specified permissions
 */
export async function checkAllPermissions(adminId: string, permissionCodes: string[]): Promise<boolean> {
	const roles = await getRolesForAdmin(adminId);
	if (!roles.length) {
		return false;
	}

	const roleIds = roles.map((role) => role.id);
	for (const permissionCode of permissionCodes) {
		const hasPermission = await hasAnyPermission(roleIds, permissionCode);
		if (!hasPermission) {
			return false;
		}
	}
	return true;
}

/**
 * Check if admin can access a specific state
 */
export function canAccessState(context: AdminContext, state: string): boolean {
	const { admin, roles } = context;

	// Super admin can access all states
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin can only access their assigned state
	if (roles.some((role) => role.code === 'state_admin')) {
		return admin.state === state;
	}

	// District, zone, and locality admins inherit state from their location
	return admin.state === state;
}

/**
 * Check if admin can access a specific district
 */
export function canAccessDistrict(context: AdminContext, district: string, state?: string): boolean {
	const { admin, roles } = context;

	// Super admin can access all districts
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin can access all districts in their state
	if (roles.some((role) => role.code === 'state_admin')) {
		if (state && admin.state !== state) {
			return false;
		}
		return true;
	}

	// District admin can access their assigned district (or all in their state if state admin)
	if (roles.some((role) => role.code === 'district_admin')) {
		// Company district admin can access all districts in their state
		if (admin.adminType === 'company') {
			if (state && admin.state !== state) {
				return false;
			}
			return true;
		}
		// Franchise district admin can only access their own district
		return admin.district === district;
	}

	// Zone and locality admins inherit district from their location
	if (state && admin.state !== state) {
		return false;
	}
	return admin.district === district;
}

/**
 * Check if admin can access a specific zone
 */
export function canAccessZone(context: AdminContext, zone: string, district?: string, state?: string): boolean {
	const { admin, roles } = context;

	// Super admin can access all zones
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin can access all zones in their state
	if (roles.some((role) => role.code === 'state_admin')) {
		if (state && admin.state !== state) {
			return false;
		}
		return true;
	}

	// District admin can access all zones in their district
	if (roles.some((role) => role.code === 'district_admin')) {
		if (state && admin.state !== state) {
			return false;
		}
		if (district && admin.district !== district && admin.adminType === 'franchise') {
			return false;
		}
		return true;
	}

	// Zone admin can access their assigned zone (or all in their district if district admin)
	if (roles.some((role) => role.code === 'zone_admin')) {
		// Company zone admin can access all zones in their district
		if (admin.adminType === 'company') {
			if (district && admin.district !== district) {
				return false;
			}
			return true;
		}
		// Franchise zone admin can only access their own zone
		return admin.zone === zone;
	}

	// Locality supervisor inherits zone from their location
	if (district && admin.district !== district) {
		return false;
	}
	return admin.zone === zone;
}

/**
 * Check if admin can access a specific locality
 */
export function canAccessLocality(
	context: AdminContext,
	locality: string,
	zone?: string,
	district?: string,
	state?: string
): boolean {
	const { admin, roles } = context;

	// Super admin can access all localities
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin can access all localities in their state
	if (roles.some((role) => role.code === 'state_admin')) {
		if (state && admin.state !== state) {
			return false;
		}
		return true;
	}

	// District admin can access all localities in their district
	if (roles.some((role) => role.code === 'district_admin')) {
		if (state && admin.state !== state) {
			return false;
		}
		if (district && admin.district !== district && admin.adminType === 'franchise') {
			return false;
		}
		return true;
	}

	// Zone admin can access all localities in their zone
	if (roles.some((role) => role.code === 'zone_admin')) {
		if (district && admin.district !== district) {
			return false;
		}
		if (zone && admin.zone !== zone && admin.adminType === 'franchise') {
			return false;
		}
		return true;
	}

	// Locality supervisor can only access their assigned locality
	if (roles.some((role) => role.code === 'locality_supervisor')) {
		if (zone && admin.zone !== zone) {
			return false;
		}
		return admin.locality === locality;
	}

	return false;
}

/**
 * Check if admin can modify another admin (based on hierarchy and type)
 * Note: This function should be used with targetAdmin's roles loaded separately if needed
 */
export function canModifyAdmin(context: AdminContext, targetAdmin: AdminUserRecord, targetRoles?: AdminRoleRecord[]): boolean {
	const { admin, roles } = context;

	// Super admin can modify anyone
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin cannot modify super admin or other state admins
	if (roles.some((role) => role.code === 'state_admin')) {
		if (targetRoles) {
			if (targetRoles.some((role) => role.code === 'super_admin' || role.code === 'state_admin')) {
				return false;
			}
		}
		// Can only modify admins in their state
		return admin.state === targetAdmin.state;
	}

	// District admin (company) can modify zone and locality admins in their district
	if (roles.some((role) => role.code === 'district_admin') && admin.adminType === 'company') {
		// Can modify franchise admins in their district
		if (targetAdmin.adminType === 'franchise') {
			return admin.district === targetAdmin.district && admin.state === targetAdmin.state;
		}
		// Can modify company zone and locality admins in their district
		if (targetRoles) {
			const canModifyRoles = ['zone_admin', 'locality_supervisor'];
			if (targetRoles.some((role) => canModifyRoles.includes(role.code))) {
				return admin.district === targetAdmin.district && admin.state === targetAdmin.state;
			}
		}
		return false;
	}

	// District admin (franchise) cannot modify company staff
	if (roles.some((role) => role.code === 'district_admin') && admin.adminType === 'franchise') {
		if (targetAdmin.adminType === 'company') {
			return false;
		}
		// Can only modify franchise admins in their district
		return admin.district === targetAdmin.district && admin.state === targetAdmin.state;
	}

	// Zone admin can modify locality supervisors in their zone
	if (roles.some((role) => role.code === 'zone_admin')) {
		if (targetRoles) {
			if (targetRoles.some((role) => role.code === 'locality_supervisor')) {
				return admin.zone === targetAdmin.zone && admin.district === targetAdmin.district;
			}
		}
		return false;
	}

	return false;
}

/**
 * Check if admin can view financial data (considering franchise restrictions)
 */
export function canViewFinancialData(context: AdminContext, targetDistrict?: string, targetZone?: string): boolean {
	const { admin, roles } = context;

	// Super admin can view all financial data
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin can view financial data in their state
	if (roles.some((role) => role.code === 'state_admin')) {
		return true; // Can view all districts in their state
	}

	// District admin (company) can view financial data in their district
	if (roles.some((role) => role.code === 'district_admin') && admin.adminType === 'company') {
		if (targetDistrict && admin.district !== targetDistrict) {
			return false;
		}
		return true;
	}

	// District admin (franchise) can only view their own franchise financial data
	if (roles.some((role) => role.code === 'district_admin') && admin.adminType === 'franchise') {
		if (targetDistrict && admin.district !== targetDistrict) {
			return false;
		}
		return true; // Only their own franchise
	}

	// Zone admin (company) can view zone stats only
	if (roles.some((role) => role.code === 'zone_admin') && admin.adminType === 'company') {
		if (targetZone && admin.zone !== targetZone) {
			return false;
		}
		return true; // Stats only, not full financial data
	}

	// Zone admin (franchise) can view their own zone revenue
	if (roles.some((role) => role.code === 'zone_admin') && admin.adminType === 'franchise') {
		if (targetZone && admin.zone !== targetZone) {
			return false;
		}
		return true; // Only their own zone
	}

	// Locality supervisor cannot view financial data
	return false;
}

/**
 * Check if admin can override franchise decisions
 */
export function canOverrideFranchise(context: AdminContext): boolean {
	const { admin, roles } = context;

	// Only company admins can override franchise decisions
	if (admin.adminType !== 'company') {
		return false;
	}

	// Super admin, state admin, and company district admin can override
	return (
		roles.some((role) => role.code === 'super_admin') ||
		roles.some((role) => role.code === 'state_admin') ||
		(roles.some((role) => role.code === 'district_admin') && admin.adminType === 'company')
	);
}

/**
 * Check if admin can see other districts
 */
export function canSeeOtherDistricts(context: AdminContext): boolean {
	const { admin, roles } = context;

	// Super admin and state admin can see all districts
	if (roles.some((role) => role.code === 'super_admin') || roles.some((role) => role.code === 'state_admin')) {
		return true;
	}

	// Company district admin can see all districts in their state
	if (roles.some((role) => role.code === 'district_admin') && admin.adminType === 'company') {
		return true;
	}

	// Franchise district admin cannot see other districts
	return false;
}

/**
 * Check if admin can modify system settings
 */
export function canModifySystemSettings(context: AdminContext, settingType?: 'super_admin' | 'other_state'): boolean {
	const { admin, roles } = context;

	// Super admin can modify all settings
	if (roles.some((role) => role.code === 'super_admin')) {
		return true;
	}

	// State admin cannot modify super admin settings or other state settings
	if (roles.some((role) => role.code === 'state_admin')) {
		if (settingType === 'super_admin' || settingType === 'other_state') {
			return false;
		}
		return true;
	}

	// Other admins cannot modify system settings
	return false;
}

