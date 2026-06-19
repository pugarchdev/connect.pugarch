import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { buildNameSearchQuery } from '../utils/searchUtils';
import { logUserAction } from '../utils/auditLogger';
import { AuditAction, Permission, UserRole } from '../config/constants';

const router = express.Router();

// All routes require database connection and authentication
router.use(requireDatabaseConnection);
router.use(authenticate);

// @route   GET /api/users
// @desc    Get all users (scoped by role)
// @access  Private
router.get('/', requirePermission(Permission.READ_USER), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search, role, companyId, departmentId, status, sortBy, sortOrder } = req.query;
    const currentUser = req.user!;

    const query: any = {};

    // Determine target companyId for scoping
    const normalizedRole = typeof currentUser.role === 'string' ? currentUser.role.toUpperCase() : '';
    const isSuperAdmin = !!currentUser.isSuperAdmin ||
                         normalizedRole === UserRole.SUPER_ADMIN ||
                         currentUser.level === 0;
    const isCompanyAdmin = normalizedRole === UserRole.COMPANY_ADMIN || currentUser.level === 1;
    const targetCompanyId = (isSuperAdmin && companyId) ? companyId : currentUser.companyId;

    // Strict multi-tenant scoping
    if (targetCompanyId) {
      query.companyId = targetCompanyId;
      
      // If restricted to a department (for non-Super Admins), scope them.
      const userDepts = [];
      if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
      if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
        currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
      }
      const uniqueUserDepts = [...new Set(userDepts)];

      if (uniqueUserDepts.length > 0 && !isSuperAdmin && !isCompanyAdmin) {
        // Hierarchical scoping: include all sub-departments
        const Department = (await import('../models/Department')).default;
        const subDeptIds = await Department.find({ 
          parentDepartmentId: { $in: uniqueUserDepts }
        }).distinct('_id');
        
        const authorizedDeptIds = [...uniqueUserDepts, ...subDeptIds.map(id => id.toString())];
        
        if (departmentId) {
          // Drill-down within authorized scope
          const filterDeptIds = typeof departmentId === 'string' && departmentId.includes(',') 
            ? departmentId.split(',') 
            : [departmentId];
          
          // Intersection: only allow filtering by departments the user is authorized to see
          const validFilterIds = filterDeptIds.filter(id => authorizedDeptIds.includes(id as string));
          
          if (validFilterIds.length > 0) {
            query.departmentIds = { $in: validFilterIds };
          } else {
            // If requested departments are outside scope, restrict to authorized scope
            query.departmentIds = { $in: authorizedDeptIds };
          }
        } else {
          // General hierarchical visibility: Their department chain + Global personnel
          query.$or = [
            { departmentIds: { $in: [...authorizedDeptIds, null] } },
            { departmentIds: { $exists: false } }
          ];
        }
      } else if (departmentId) {
        // Even Company Admins or Super Admins in drilldown can filter by department
        const filterDeptIds = typeof departmentId === 'string' && departmentId.includes(',') 
          ? departmentId.split(',') 
          : [departmentId];
          
        query.departmentIds = { $in: filterDeptIds };
      }
    } else if (isSuperAdmin) {
      // 🛡️ SECURITY: Super Admin without companyId should see nothing in user list
      return res.json({ 
        success: true, 
        data: { 
          users: [], 
          pagination: { page: 1, limit: Number(limit), total: 0, pages: 0 } 
        } 
      });
    } else {
      // Safety check: Non-SuperAdmins MUST have a companyId
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: User missing company assignment'
      });
    }

    // 🔍 SEARCH LOGIC
    if (search) {
      // 1. Basic field search (everything visible on screen)
      const searchCriteria: any[] = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { designations: { $regex: search, $options: 'i' } },
        ...buildNameSearchQuery(search as string, 'firstName', 'lastName')
      ];

      // 2. Department Name Search (Relational)
      const Department = (await import('../models/Department')).default;
      const matchingDepts = await Department.find({
        companyId: targetCompanyId || { $exists: true },
        $or: [
          { name: { $regex: search as string, $options: 'i' } },
          { nameHi: { $regex: search as string, $options: 'i' } },
          { nameOr: { $regex: search as string, $options: 'i' } },
          { nameMr: { $regex: search as string, $options: 'i' } },
          { departmentId: { $regex: search as string, $options: 'i' } }
        ]
      }).select('_id');
      
      if (matchingDepts.length > 0) {
        const deptIdsArr = matchingDepts.map(d => d._id);
        searchCriteria.push({ 
          departmentIds: { $in: deptIdsArr }
        });
      }

      // 3. Custom Role Name Search (Relational)
      const Role = (await import('../models/Role')).default;
      const matchingRoles = await Role.find({
        companyId: targetCompanyId || { $exists: true },
        name: { $regex: search as string, $options: 'i' }
      }).select('_id');

      if (matchingRoles.length > 0) {
        const roleIdsArr = matchingRoles.map(r => r._id);
        searchCriteria.push({ customRoleId: { $in: roleIdsArr } });
      }

      // Merge with existing filters (like role or companyId)
      if (query.$or) {
        const existingOr = query.$or;
        delete query.$or;
        query.$and = [
          { $or: existingOr },
          { $or: searchCriteria }
        ];
      } else {
        query.$or = searchCriteria;
      }
    }

    if (role) {
      // Role filter now always uses customRoleId (all users must have one)
      query.customRoleId = role;
    }

    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }

    // Build dynamic sort object
    let sortObj: any = { createdAt: -1 };
    if (sortBy) {
      const order = sortOrder === 'asc' ? 1 : -1;
      
      // Map frontend keys to backend fields
      if (sortBy === 'firstName') {
        sortObj = { firstName: order, lastName: order };
      } else if (sortBy === 'role') {
        sortObj = { customRoleId: order };
      } else {
        sortObj = { [sortBy as string]: order };
      }
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .populate('companyId', 'name companyId')
        .populate('departmentIds', 'name departmentId') // Populate multiple departments
        .populate('customRoleId', 'name')
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit))
        .sort(sortObj),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// @route   POST /api/users
// @desc    Create new user
// @access  Private
router.post('/', requirePermission(Permission.CREATE_USER), async (req: Request, res: Response) => {
  try {
    console.log('📝 User creation request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const currentUser = req.user!;
    console.log('Current user:', { id: currentUser._id, isSuperAdmin: currentUser.isSuperAdmin, level: currentUser.level, companyId: currentUser.companyId });
    
    // Access is determined by CREATE_USER permission (already checked in middleware)
    // Permission-based RBAC is now the single source of truth.
    
    const { firstName, lastName, email, password, phone, role, departmentId, departmentIds, customRoleId, designation, designations } = req.body;
    let companyId = req.body.companyId;

    // Validation
    let submissionCustomRoleId = customRoleId;
    if (!submissionCustomRoleId && role === UserRole.SUPER_ADMIN) {
      const Role = (await import('../models/Role')).default;
      const systemSuperAdminRole = await Role.findOne({ level: 0 });
      if (systemSuperAdminRole) {
          submissionCustomRoleId = systemSuperAdminRole._id;
          console.log('✅ Auto-assigned system Super Admin role ID:', submissionCustomRoleId);
      }
    }

    if (!firstName || !lastName || !password || !submissionCustomRoleId) {
      console.log('❌ Validation failed: Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (Name, Password, and Role)'
      });
    }

    // Validate password length
    if (password.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 5 characters'
      });
    }

    // Validate and normalize phone number if provided
    let normalizedPhone = phone;
    if (phone && phone.trim()) {
      const { validatePhoneNumber, normalizePhoneNumber } = await import('../utils/phoneUtils');
      const phoneTrimmed = phone.trim();
      if (!validatePhoneNumber(phoneTrimmed)) {
        return res.status(400).json({
          success: false,
          message: 'Phone number must be exactly 10 digits'
        });
      }
      normalizedPhone = normalizePhoneNumber(phoneTrimmed);
    } else {
      // If phone is empty or not provided, set to undefined
      normalizedPhone = undefined;
    }
    console.log('✅ Basic validation passed');

    // Scope validation and role-specific requirements
    // Scope validation
    if (!currentUser.isSuperAdmin) {
      // Non-SuperAdmins can only create users in their own company
      if (companyId && companyId !== currentUser.companyId?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only create users for your own company'
        });
      }

      // If restricted by department
      if (currentUser.departmentId && departmentId !== currentUser.departmentId?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only create users for your own department'
        });
      }

      // Prohibit creating SuperAdmins
      if (role === UserRole.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'You cannot create SuperAdmin users'
        });
      }
      
      // Auto-set companyId if not provided
      if (!companyId && currentUser.companyId) {
        companyId = currentUser.companyId.toString();
      }
    }

    // ─── Hierarchical Creation Rights (Dynamic) ──────────────────────────────────
    if (!currentUser.isSuperAdmin) {
      // 1. Operator Check: Operators cannot create any users
      if (currentUser.level === 4) {
        return res.status(403).json({
          success: false,
          message: 'Operators are not authorized to create personnel'
        });
      }

      // 2. Fetch the target role details
      let targetRoleName = role || '';
      if (customRoleId) {
        const Role = (await import('../models/Role')).default;
        const cRole = await Role.findById(customRoleId);
        if (cRole) targetRoleName = cRole.name;
      }
      
      const targetRoleLower = targetRoleName.toLowerCase();
      const creatorLevel = currentUser.level || 5;

      // 3. Level-Based Enforcement
      // Rules:
      // - Company Admin: Can create anything except SuperAdmin
      // - Dept Admin: Can create Dept Admin, Sub-Dept Admin, Operator
      // - Sub-Dept Admin: Can create Sub-Dept Admin, Operator

      if (creatorLevel === 3) {
        // 🔒 Sub-Dept Admin (Level 3) can ONLY create Operators (Level 4)
        const allowedTargets = ['operator'];
        if (!allowedTargets.some(t => targetRoleLower.includes(t))) {
          return res.status(403).json({
            success: false,
            message: 'Sub-Department Administrators can only create Operator level personnel'
          });
        }
      } else if (creatorLevel === 2) {
        // 🛡️ Dept Admin (Level 2) can create Sub-Dept Admin (Level 3) or Operator (Level 4)
        const allowedTargets = ['sub-department admin', 'sub department admin', 'operator'];
        if (!allowedTargets.some(t => targetRoleLower.includes(t))) {
          return res.status(403).json({
            success: false,
            message: 'Department Administrators can only assign Sub-Department Admin or Operator roles'
          });
        }
      }
      // Company Admin (default if not dept/sub-dept) can create anything within the company
    }

    console.log('✅ Hierarchy validation passed');
    
    // Determine the target company for the new user
    let finalCompanyId = companyId;
    if (departmentId && !finalCompanyId) {
      const Department = (await import('../models/Department')).default;
      const department = await Department.findById(departmentIds?.[0] || departmentId);
      if (department) {
        finalCompanyId = department.companyId.toString();
        console.log('✅ Auto-set companyId from department:', finalCompanyId);
      }
    }

    // Company ID remains mandatory for all roles except SuperAdmin
    if (!finalCompanyId && !currentUser.isSuperAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }
    
    console.log('✅ Scope validation passed');
    
    // Check if email already exists in the same company
    // Allow same email/phone across different companies, but not within the same company
    // For SUPER_ADMIN (companyId = null), keep email/phone globally unique
    if (email) {
      const emailQuery: any = { 
        email: email.toLowerCase().trim()
      };
      
      // For SUPER_ADMIN, check globally; for others, check within company
      if (finalCompanyId) {
        emailQuery.companyId = finalCompanyId;
      } else {
        // SUPER_ADMIN: check globally (companyId is null or undefined)
        emailQuery.$or = [
          { companyId: null },
          { companyId: { $exists: false } }
        ];
      }
      
      const existingUser = await User.findOne(emailQuery);
      if (existingUser) {
        console.log('❌ User with email already exists:', email);
        const message = finalCompanyId 
          ? 'User with this email already exists in this company'
          : 'User with this email already exists';
        return res.status(400).json({
          success: false,
          message
        });
      }
    }
    console.log('✅ Email is unique');

    // Check if phone already exists in the same company
    if (normalizedPhone) {
      const phoneQuery: any = { 
        phone: normalizedPhone
      };
      
      // For SUPER_ADMIN, check globally; for others, check within company
      if (finalCompanyId) {
        phoneQuery.companyId = finalCompanyId;
      } else {
        // SUPER_ADMIN: check globally (companyId is null or undefined)
        phoneQuery.$or = [
          { companyId: null },
          { companyId: { $exists: false } }
        ];
      }
      
      const existingPhoneUser = await User.findOne(phoneQuery);
      if (existingPhoneUser) {
        console.log('❌ User with phone already exists:', normalizedPhone);
        const message = finalCompanyId 
          ? 'User with this phone number already exists in this company'
          : 'User with this phone number already exists';
        return res.status(400).json({
          success: false,
          message
        });
      }
    }
    console.log('✅ Phone is unique');
    
    console.log('Creating user with data:', { firstName, lastName, email, role, companyId: finalCompanyId, departmentId, departmentIds });
    
    // Database connection is already checked by middleware

    // Synchronize departmentId and departmentIds for compatibility
    const finalDeptIds = (Array.isArray(departmentIds) && departmentIds.length > 0) 
      ? departmentIds.map(id => id.toString())
      : (departmentId ? [departmentId.toString()] : []);
    
    // Set singular for backward compatibility if it's not set but plural is
    const finalDeptId = departmentId || (finalDeptIds.length > 0 ? finalDeptIds[0] : undefined);

    // Create user in database
    let user;
    try {
      user = await User.create({
        firstName,
        lastName,
        email: email ? email.toLowerCase().trim() : undefined,
        password,
        phone: normalizedPhone,
        designations: (Array.isArray(designations) && designations.length > 0) ? designations : (designation ? [designation] : undefined),
        customRoleId: submissionCustomRoleId,
        companyId: finalCompanyId || undefined,
        departmentId: finalDeptId,
        departmentIds: finalDeptIds,
        isActive: true,
        isSuperAdmin: role === UserRole.SUPER_ADMIN,
        rawPassword: password,
        createdBy: currentUser._id // Track who created this user for hierarchical rights
      });
      console.log('✅ User created successfully in database:', user.userId);
      console.log('✅ User ID:', user._id);
      console.log('✅ User companyId:', user.companyId);
      console.log('✅ User departmentId:', user.departmentId);
    } catch (dbError: any) {
      console.error('❌ Database save error:', dbError);
      console.error('Error name:', dbError.name);
      console.error('Error code:', dbError.code);
      console.error('Error message:', dbError.message);
      
      // Handle duplicate key error
      if (dbError.code === 11000) {
        const field = Object.keys(dbError.keyPattern || {})[0];
        return res.status(400).json({
          success: false,
          message: `User with this ${field} already exists`,
          error: dbError.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to save user to database',
        error: dbError.message
      });
    }

    // Verify user was saved
    const savedUser = await User.findById(user._id);
    if (!savedUser) {
      console.error('❌ User was not saved to database');
      return res.status(500).json({
        success: false,
        message: 'User creation failed - user not found in database'
      });
    }
    console.log('✅ Verified user exists in database:', savedUser.userId);

    // Audit logging - don't let this fail the request
    try {
      await logUserAction(
        req,
        AuditAction.CREATE,
        'User',
        user._id.toString(),
        { userName: user.getFullName(), email: user.email }
      );
      console.log('✅ Audit log created');
    } catch (auditError: any) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError.message);
    }

    // Automatically update department contact info if user has department management permissions OR is a Department Admin
    if (departmentId) {
      const { normalizePhoneNumber } = await import('../utils/phoneUtils');
      const finalPhone = normalizePhoneNumber(phone || '');
      
      // Update if explicit permission or if role implies it
      const isDeptAdmin = role && role.toLowerCase().includes('admin');
      
      if (req.checkPermission(Permission.UPDATE_DEPARTMENT) || isDeptAdmin) {
        try {
          const Department = (await import('../models/Department')).default;
          await Department.findByIdAndUpdate(departmentId, {
            contactPerson: `${firstName} ${lastName}`,
            contactEmail: email.toLowerCase().trim(),
            contactPhone: finalPhone
          });
          console.log(`✅ Updated department ${departmentId} contact info with admin details`);
        } catch (deptUpdateError: any) {
          console.error('⚠️ Failed to update department contact info (non-critical):', deptUpdateError.message);
        }
      }
    }

    const userResponse = savedUser.toObject();
    delete userResponse.password;

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: {
          ...userResponse,
          id: savedUser._id // include both for compatibility
        }
      }
    });
  } catch (error: any) {
    console.error('❌ User creation error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get('/:id', requirePermission(Permission.READ_USER), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const user = await User.findById(req.params.id)
      .populate('companyId', 'name companyId')
      .populate('departmentIds', 'name departmentId')
      .populate('customRoleId', 'name')
      .select('-password');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check access
    if (!currentUser.isSuperAdmin) {
      if (user.companyId?._id.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      // 🏢 Multi-Department & Hierarchical Scoping
      const userDepts: string[] = [];
      if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
      if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
        currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
      }

      if (userDepts.length > 0) {
        const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
        const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

        const targetDeptId = (user.departmentId?._id ? user.departmentId._id.toString() : user.departmentId?.toString()) || "";
        const targetDeptIds = (user.departmentIds || []).map((d: any) => (d._id || d).toString());

        const hasAccess = authorizedDeptIds.includes(targetDeptId) || 
                          targetDeptIds.some(id => authorizedDeptIds.includes(id));

        if (!hasAccess) {
          res.status(403).json({ success: false, message: 'Access denied: User belongs to a different department scope' });
          return;
        }
      }
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private
router.put('/:id', requirePermission(Permission.UPDATE_USER), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const existingUser = await User.findById(req.params.id);

    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check for fine-grained update permission
    if (!req.checkPermission(Permission.UPDATE_USER)) {
      res.status(403).json({ success: false, message: 'You do not have permission to update users' });
      return;
    }

    // Prevent self-deactivation
    if (existingUser._id.toString() === currentUser._id.toString() && req.body.isActive === false) {
      res.status(403).json({
        success: false,
        message: 'You cannot deactivate yourself'
      });
      return;
    }

    // Prevent users from editing their own scope
    if (existingUser._id.toString() === currentUser._id.toString()) {
      if (req.body.customRoleId && req.body.customRoleId !== existingUser.customRoleId?.toString()) {
        res.status(403).json({
          success: false,
          message: 'You cannot change your own role'
        });
        return;
      }
      if (req.body.departmentId && req.body.departmentId !== existingUser.departmentId?.toString()) {
        res.status(403).json({
          success: false,
          message: 'You cannot change your own department'
        });
        return;
      }
    }

    // Build a clean update object with only whitelisted schema fields
    const allowedFields = [
      'firstName', 'lastName', 'email', 'phone', 'password',
      'designations', 'departmentIds', 'companyId',
      'customRoleId', 'isActive', 'notificationSettings', 'responsibleAreas'
    ];

    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Handle 'designation' (virtual) -> push into designations array
    if (req.body.designation && typeof req.body.designation === 'string' && req.body.designation.trim()) {
      if (!updateData.designations || !Array.isArray(updateData.designations)) {
        updateData.designations = existingUser.designations || [];
      }
      if (!updateData.designations.includes(req.body.designation.trim())) {
        updateData.designations.unshift(req.body.designation.trim());
      }
    }

    // Handle 'departmentId' (virtual) -> merge into departmentIds
    if (req.body.departmentId && !updateData.departmentIds?.length) {
      updateData.departmentIds = [req.body.departmentId];
    }

    // Clean up empty strings and ensure valid IDs
    if (updateData.companyId === '') updateData.companyId = null;
    if (updateData.customRoleId === '') updateData.customRoleId = null;
    if (updateData.email === '') updateData.email = null;

    // Filter out invalid empty strings or nulls from departmentIds array
    if (updateData.departmentIds && Array.isArray(updateData.departmentIds)) {
      updateData.departmentIds = updateData.departmentIds.filter((id: any) => 
        id && typeof id === 'string' && id.trim() !== ""
      );
    }

    // Replace req.body with the cleaned update object for downstream usage
    req.body = updateData;
    console.log('🔄 Sanitized update payload:', JSON.stringify(updateData, null, 2));

    // Check access based on company/department scope
    if (!currentUser.isSuperAdmin) {
      if (existingUser.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }
      // 🏢 Multi-Department & Hierarchical Scoping
      const userDepts: string[] = [];
      if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
      if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
        currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
      }

      if (userDepts.length > 0) {
        const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
        const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

        const targetDeptId = existingUser.departmentId?.toString() || "";
        const targetDeptIds = (existingUser.departmentIds || []).map((id: any) => id.toString());

        const hasAccess = authorizedDeptIds.includes(targetDeptId) || 
                          targetDeptIds.some(id => authorizedDeptIds.includes(id));

        if (!hasAccess) {
          res.status(403).json({ success: false, message: 'Access denied: Management scope restricted to authorized departments' });
          return;
        }
      }
    }

    // Hierarchical Rights Enforcement (Dynamic)
    if (!currentUser.isSuperAdmin) {
      // 1. Level Check: Department users cannot edit Company-level users
      if (currentUser.departmentId && !existingUser.departmentId) {
        res.status(403).json({
          success: false,
          message: 'Department users cannot edit Company-level administrators'
        });
        return;
      }

      // 2. Creator Check: If both are at the same level (both Company or same Department)
      // and the target is not the current user themselves, only allow if current user created the target
      // This prevents horizontal privilege escalation between admins of the same level.
      const isSameLevel = (!!currentUser.departmentId === !!existingUser.departmentId);
      const isSelf = existingUser._id.toString() === currentUser._id.toString();

      if (isSameLevel && !isSelf) {
         const targetCreatorId = existingUser.createdBy?.toString();
         const targetCreator = targetCreatorId ? await User.findById(targetCreatorId) : null;
         const isCreatedBySuperAdmin = !targetCreatorId || targetCreator?.isSuperAdmin;

         // Primary admins (created by SuperAdmin) can only be edited by SuperAdmin
         if (isCreatedBySuperAdmin) {
           res.status(403).json({
             success: false,
             message: 'This is a primary account. Only SuperAdmin can modify it.'
           });
           return;
         }

         // Otherwise, verify creator chain
         if (targetCreatorId !== currentUser._id.toString()) {
            res.status(403).json({
              success: false,
              message: 'You can only edit accounts that you created.'
            });
            return;
         }
      }
    }

    // Role-based restrictions for role changes
    if (req.body.customRoleId) {
      if (!currentUser.isSuperAdmin) {
        const Role = (await import('../models/Role')).default;
        const targetRole = await Role.findById(req.body.customRoleId);
        
        if (targetRole) {
          const targetRoleLower = targetRole.name.toLowerCase();
          const creatorLevel = currentUser.level || 5;

          if (targetRole.key === 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: 'You cannot assign SuperAdmin role' });
          }

          if (creatorLevel === 3) {
            // 🔒 Sub-Dept Admin (Level 3) can ONLY assign Operators (Level 4)
            const allowedTargets = ['operator'];
            if (!allowedTargets.some(t => targetRoleLower.includes(t))) {
              return res.status(403).json({
                success: false,
                message: 'Sub-Department Administrators can only assign Operator roles'
              });
            }
          } else if (creatorLevel === 2) {
            // 🛡️ Dept Admin (Level 2) can assign Sub-Dept Admin (Level 3) or Operator (Level 4)
            const allowedTargets = ['sub-department admin', 'sub department admin', 'operator'];
            if (!allowedTargets.some(t => targetRoleLower.includes(t))) {
              return res.status(403).json({
                success: false,
                message: 'Department Administrators can only assign Sub-Department Admin or Operator roles'
              });
            }
          }
        }
      }
    }

    // 🔒 Password Update Authorization: Only Company Admin or higher can set passwords for others
    if (req.body.password) {
      const isSuperAdminUser = currentUser.isSuperAdmin || currentUser.level === 0;
      const isCompanyAdmin = currentUser.level === 1;
      
      if (!isSuperAdminUser && !isCompanyAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only Company Administrators or higher can reset user passwords'
        });
      }
      
      // Also update rawPassword for administrator visibility (per project pattern)
      req.body.rawPassword = req.body.password;
    }

    // Normalize empty strings to undefined for optional fields
    if (req.body.email === "") req.body.email = undefined;
    if (req.body.phone === "") req.body.phone = undefined;

    // Check if email/phone is being updated and validate uniqueness within the same company
    // For SUPER_ADMIN (companyId = null), keep email/phone globally unique
    if (req.body.email && req.body.email !== existingUser.email) {
      const normalizedEmail = req.body.email.toLowerCase().trim();
      const emailQuery: any = {
        email: normalizedEmail,
        _id: { $ne: existingUser._id } // Exclude current user
      };
      
      // For SUPER_ADMIN, check globally; for others, check within company
      if (existingUser.companyId) {
        emailQuery.companyId = existingUser.companyId;
      } else {
        // SUPER_ADMIN: check globally (companyId is null or undefined)
        emailQuery.$or = [
          { companyId: null },
          { companyId: { $exists: false } }
        ];
      }
      
      const conflictingUser = await User.findOne(emailQuery);
      
      if (conflictingUser) {
        const message = existingUser.companyId 
          ? 'User with this email already exists in this company'
          : 'User with this email already exists';
        return res.status(400).json({
          success: false,
          message
        });
      }
    }

    // Check if phone is being updated and validate uniqueness within the same company
    if (req.body.phone && req.body.phone !== existingUser.phone) {
      // Normalize phone number
      let normalizedPhone = req.body.phone;
      if (normalizedPhone && normalizedPhone.trim()) {
        const { validatePhoneNumber, normalizePhoneNumber } = await import('../utils/phoneUtils');
        const phoneTrimmed = normalizedPhone.trim();
        if (!validatePhoneNumber(phoneTrimmed)) {
          return res.status(400).json({
            success: false,
            message: 'Phone number must be exactly 10 digits'
          });
        }
        normalizedPhone = normalizePhoneNumber(phoneTrimmed);
      }

      const phoneQuery: any = {
        phone: normalizedPhone,
        _id: { $ne: existingUser._id } // Exclude current user
      };
      
      // For SUPER_ADMIN, check globally; for others, check within company
      if (existingUser.companyId) {
        phoneQuery.companyId = existingUser.companyId;
      } else {
        // SUPER_ADMIN: check globally (companyId is null or undefined)
        phoneQuery.$or = [
          { companyId: null },
          { companyId: { $exists: false } }
        ];
      }

      const conflictingUser = await User.findOne(phoneQuery);
      
      if (conflictingUser) {
        const message = existingUser.companyId 
          ? 'User with this phone number already exists in this company'
          : 'User with this phone number already exists';
        return res.status(400).json({
          success: false,
          message
        });
      }
      
      // Update the phone in req.body with normalized version
      req.body.phone = normalizedPhone;
    }

    // Synchronize departmentId and departmentIds for compatibility in update
    if (req.body.departmentIds || req.body.departmentId) {
       const plural = Array.isArray(req.body.departmentIds) ? req.body.departmentIds : [];
       const singular = req.body.departmentId;
       
       if (req.body.departmentIds && !req.body.departmentId && plural.length > 0) {
          req.body.departmentId = plural[0];
       } else if (req.body.departmentId && (!req.body.departmentIds || plural.length === 0)) {
          req.body.departmentIds = [req.body.departmentId];
       } else if (req.body.departmentId && req.body.departmentIds && !plural.includes(req.body.departmentId)) {
          // Both provided, ensure singular is part of plural
          req.body.departmentIds.unshift(req.body.departmentId);
       }
    }

    // Perform update using .save() to trigger pre-save hooks (for password hashing)
    const userToUpdate = await User.findById(req.params.id);
    if (!userToUpdate) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Apply updates from req.body
    Object.keys(req.body).forEach(key => {
      (userToUpdate as any)[key] = req.body[key];
    });

    await userToUpdate.save();
    
    let user = await User.findById(req.params.id)
      .populate('companyId', 'name companyId')
      .populate('departmentIds', 'name departmentId')
      .populate('customRoleId', 'name')
      .select('-password');

    await logUserAction(
      req,
      AuditAction.UPDATE,
      'User',
      user!._id.toString(),
      { updates: req.body }
    );

    // Automatically update department contact info if the user has department management permissions OR is a Department Admin
    if (user && user.departmentId) {
      const customRole: any = user.customRoleId; // already populated with 'name'
      const roleName = customRole ? customRole.name : (user.designation || '');
      
      const Role = (await import('../models/Role')).default;
      const managementRole = customRole ? await Role.findOne({
        _id: (customRole as any)._id,
        'permissions.module': 'DEPARTMENTS',
        'permissions.actions': { $in: ['update', 'all', 'manage'] }
      }) : null;

      const isDeptAdmin = roleName.toLowerCase().includes('admin');

      if (managementRole || isDeptAdmin || req.checkPermission(Permission.UPDATE_DEPARTMENT)) {
        // Fire and forget (don't await for faster response)
        (async () => {
          try {
            const Department = (await import('../models/Department')).default;
            const deptId = user.departmentId instanceof Object && '_id' in user.departmentId 
              ? (user.departmentId as any)._id 
              : user.departmentId;

            await Department.findByIdAndUpdate(deptId, {
              contactPerson: `${user.firstName} ${user.lastName}`,
              contactEmail: user.email,
              contactPhone: user.phone
            });
            console.log(`✅ Automatically updated department ${deptId} contact info`);
          } catch (deptUpdateError: any) {
            console.error('⚠️ Failed to update department contact info:', deptUpdateError.message);
          }
        })();
      }
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error: any) {
    console.error('❌ Error updating user:', error);

    // Handle MongoDB Duplicate Key errors (Code 11000)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      const value = error.keyValue ? error.keyValue[field] : 'unknown';
      return res.status(400).json({
        success: false,
        message: `User with this ${field} (${value}) already exists.`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
});

// @route   POST /api/users/:id/reset-password
// @desc    Reset a user's password from admin dashboard
// @access  Private (requires UPDATE_USER permission)
router.post('/:id/reset-password', requirePermission(Permission.UPDATE_USER), async (req: Request, res: Response) => {
  try {
    const { password } = req.body as { password?: string };
    const currentUser = req.user!;

    if (!password || password.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const targetUser = await User.findById(req.params.id).select('+password');
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!currentUser.isSuperAdmin) {
      if (
        !currentUser.companyId ||
        !targetUser.companyId ||
        targetUser.companyId.toString() !== currentUser.companyId.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Cross-company password reset is not allowed'
        });
      }
    }

    targetUser.password = password.trim();
    targetUser.resetPasswordOtpHash = undefined;
    targetUser.resetPasswordOtpExpires = undefined;
    targetUser.resetPasswordOtpChannel = undefined;
    targetUser.resetPasswordOtpAttempts = 0;
    await targetUser.save();

    await logUserAction(
      req,
      AuditAction.UPDATE,
      'User',
      targetUser._id.toString(),
      { action: 'ADMIN_PASSWORD_RESET' }
    );

    return res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: error.message
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Soft delete user
// @access  Private
router.delete('/:id', requirePermission(Permission.DELETE_USER), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const existingUser = await User.findById(req.params.id);

    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Prevent self-deletion
    if (existingUser._id.toString() === currentUser._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'You cannot delete yourself'
      });
      return;
    }

    // Check access based on company/department scope
    if (!currentUser.isSuperAdmin) {
      if (existingUser.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }
      // 🏢 Multi-Department & Hierarchical Scoping
      const userDepts: string[] = [];
      if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
      if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
        currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
      }

      if (userDepts.length > 0) {
        const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
        const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

        const targetDeptId = existingUser.departmentId?.toString() || "";
        const targetDeptIds = (existingUser.departmentIds || []).map((id: any) => id.toString());

        const hasAccess = authorizedDeptIds.includes(targetDeptId) || 
                          targetDeptIds.some(id => authorizedDeptIds.includes(id));

        if (!hasAccess) {
          res.status(403).json({ success: false, message: 'Access denied: Management scope restricted to authorized departments' });
          return;
        }
      }
    }

    // 1. Permission Check
    if (!req.checkPermission(Permission.DELETE_USER)) {
      res.status(403).json({ success: false, message: 'You do not have permission to delete users' });
      return;
    }

    // 2. Hierarchical Rights Enforcement (Dynamic)
    if (!currentUser.isSuperAdmin) {
      // 2.1 Level Check: Department users cannot delete Company-level users
      if (currentUser.departmentId && !existingUser.departmentId) {
        res.status(403).json({
          success: false,
          message: 'Department users cannot delete Company-level administrators'
        });
        return;
      }

      // 2.2 Creator Check
      const isSameLevel = (!!currentUser.departmentId === !!existingUser.departmentId);
      const isSelf = existingUser._id.toString() === currentUser._id.toString();

      if (isSameLevel && !isSelf) {
         const targetCreatorId = existingUser.createdBy?.toString();
         const targetCreator = targetCreatorId ? await User.findById(targetCreatorId) : null;
         const isCreatedBySuperAdmin = !targetCreatorId || targetCreator?.isSuperAdmin;

         if (isCreatedBySuperAdmin) {
           res.status(403).json({
             success: false,
             message: 'This is a primary account. Only SuperAdmin can modify it.'
           });
           return;
         }

         if (targetCreatorId !== currentUser._id.toString()) {
            res.status(403).json({
              success: false,
              message: 'You can only delete accounts that you created.'
            });
            return;
         }
      }
      // 2.3 Sub-Dept Admin Check: Cannot delete any users
      if (currentUser.level !== undefined && currentUser.level >= 3) {
        return res.status(403).json({
          success: false,
          message: 'Sub-Department Administrators are not authorized to delete personnel'
        });
      }
    }
    // 3. Workload Check: Ensure user has no active grievances or appointments assigned
    const Grievance = (await import('../models/Grievance')).default;
    const Appointment = (await import('../models/Appointment')).default;

    const [activeGrievanceCount, activeAppointmentCount] = await Promise.all([
      Grievance.countDocuments({
        assignedTo: existingUser._id,
        status: { $in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'REVERTED'] }
      }),
      Appointment.countDocuments({
        assignedTo: existingUser._id,
        status: { $in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }
      })
    ]);

    if (activeGrievanceCount > 0 || activeAppointmentCount > 0) {
      const reasons: string[] = [];
      if (activeGrievanceCount > 0) {
        reasons.push(`${activeGrievanceCount} open/assigned grievance(s)`);
      }
      if (activeAppointmentCount > 0) {
        reasons.push(`${activeAppointmentCount} pending appointment(s)`);
      }

      res.status(400).json({
        success: false,
        message: `This user cannot be deleted because they are currently assigned to ${reasons.join(' and ')}. To prevent data loss: 1) Reassign these active items to someone else, or 2) Deactivate this account instead of deleting it.`
      });
      return;
    }

    const user = await User.findByIdAndDelete(req.params.id);

    await logUserAction(
      req,
      AuditAction.DELETE,
      'User',
      user!._id.toString()
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
});

// @route   PUT /api/users/:id/activate
// @desc    Activate/deactivate user
// @access  Private
router.put('/:id/activate', requirePermission(Permission.UPDATE_USER), async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    const currentUser = req.user!;
    const existingUser = await User.findById(req.params.id);

    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Prevent self-deactivation
    if (existingUser._id.toString() === currentUser._id.toString() && isActive === false) {
      res.status(403).json({
        success: false,
        message: 'You cannot deactivate yourself'
      });
      return;
    }

    // 1. Hierarchical Rights: Check if the user can activate/deactivate the target user
    if (!currentUser.isSuperAdmin) {
      // 1.1 Level Check: Department users cannot manage Company-level users
      if (currentUser.departmentId && !existingUser.departmentId) {
        res.status(403).json({
          success: false,
          message: 'Department users cannot manage Company-level administrators'
        });
        return;
      }

      // 1.2 Creator Check
      const isSameLevel = (!!currentUser.departmentId === !!existingUser.departmentId);
      const isSelf = existingUser._id.toString() === currentUser._id.toString();

      if (isSameLevel && !isSelf) {
         const targetCreatorId = existingUser.createdBy?.toString();
         const targetCreator = targetCreatorId ? await User.findById(targetCreatorId) : null;
         const isCreatedBySuperAdmin = !targetCreatorId || targetCreator?.isSuperAdmin;

         if (isCreatedBySuperAdmin) {
           res.status(403).json({
             success: false,
             message: 'This is a primary account. Only SuperAdmin can modify it.'
           });
           return;
         }

         if (targetCreatorId !== currentUser._id.toString()) {
            res.status(403).json({
              success: false,
              message: 'You can only manage accounts that you created.'
            });
            return;
         }
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select('-password');

    await logUserAction(
      req,
      AuditAction.UPDATE,
      'User',
      user!._id.toString(),
      { action: isActive ? 'activated' : 'deactivated' }
    );

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { user }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
});

export default router;
