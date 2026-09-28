import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import User, { IUser } from '../models/User';
import Company from '../models/Company';
import { resolveUserAccess } from '../utils/accessControl';

// Extend Express Request to include user

declare global {
  namespace Express {
    interface Request {
      user?: IUser & {
        isSuperAdmin?: boolean;
        level?: number;
        scope?: 'platform' | 'company' | 'department' | 'subdepartment' | 'assigned';
        filteredPermissions?: { module: string; actions: string[] }[];
        permissionsVersion?: number;
        roleId?: string;
        roleName?: string;
      };
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
      token = req.query.token.trim();
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'No token provided. Authentication required.'
      });
      return;
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId).select('+password');

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found. Invalid token.'
      });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({
        success: false,
        message: 'User account is inactive.'
      });
      return;
    }


    if (!decoded.isSuperAdmin && user.companyId) {
      const company = await Company.findById(user.companyId).select('isActive isSuspended').lean();

      if (!company || !company.isActive || company.isSuspended) {
        res.status(401).json({
          success: false,
          message: 'Company access is unavailable.'
        });
        return;
      }
    }

    const access = await resolveUserAccess(user);

    req.user = Object.assign(user, {
      isSuperAdmin: access.isSuperAdmin,
      level: access.level,
      scope: access.scope,
      filteredPermissions: access.filteredPermissions,
      permissionsVersion: access.permissionsVersion,
      roleId: access.roleId,
      roleName: access.roleName,
    });

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
      return;
    }

    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error.'
    });
  }
};

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId);
      
      if (user && user.isActive) {
        const access = await resolveUserAccess(user);
        req.user = Object.assign(user, {
          isSuperAdmin: access.isSuperAdmin,
          level: access.level,
          scope: access.scope,
          filteredPermissions: access.filteredPermissions,
          permissionsVersion: access.permissionsVersion,
          roleId: access.roleId,
          roleName: access.roleName,
        });
      }
    }

    next();
  } catch (_error) {
    next();
  }
};
