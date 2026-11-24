import { apiClient } from './client';

const resolveExportUrl = (path: string): URL => {
  const rawBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
  if (rawBase.startsWith('http://') || rawBase.startsWith('https://')) {
    return new URL(`${rawBase}${path}`);
  }
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:3000';
  const cleanBase = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
  return new URL(`${cleanBase}${path}`, origin);
};

export const exportAPI = {
  /**
   * Export companies (SuperAdmin only)
   */
  exportCompanies: async (): Promise<void> => {
    const url = resolveExportUrl('/export/companies');
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export companies');
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `companies-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(blobUrl);
    document.body.removeChild(a);
  },

  /**
   * Export departments
   */
  exportDepartments: async (companyId?: string): Promise<void> => {
    const url = resolveExportUrl('/export/departments');
    if (companyId) {
      url.searchParams.append('companyId', companyId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export departments');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `departments-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  /**
   * Export users
   */
  exportUsers: async (companyId?: string, departmentId?: string): Promise<void> => {
    const url = resolveExportUrl('/export/users');
    if (companyId) {
      url.searchParams.append('companyId', companyId);
    }
    if (departmentId) {
      url.searchParams.append('departmentId', departmentId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export users');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `users-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  /**
   * Export grievances
   */
  exportGrievances: async (companyId?: string, departmentId?: string, status?: string): Promise<void> => {
    const url = resolveExportUrl('/export/grievances');
    if (companyId) {
      url.searchParams.append('companyId', companyId);
    }
    if (departmentId) {
      url.searchParams.append('departmentId', departmentId);
    }
    if (status) {
      url.searchParams.append('status', status);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export grievances');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `grievances-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  /**
   * Export appointments
   */
  exportAppointments: async (companyId?: string, departmentId?: string, status?: string): Promise<void> => {
    const url = resolveExportUrl('/export/appointments');
    if (companyId) {
      url.searchParams.append('companyId', companyId);
    }
    if (departmentId) {
      url.searchParams.append('departmentId', departmentId);
    }
    if (status) {
      url.searchParams.append('status', status);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export appointments');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `appointments-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },
};
