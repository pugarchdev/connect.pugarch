'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentAPI, Department } from '@/lib/api/department';
import { SearchableSelect } from '../ui/SearchableSelect';

interface Props {
  isOpen: boolean;
  grievanceId?: string;
  onClose: () => void;
  onSubmit: (payload: { remarks: string; suggestedDepartmentId?: string; suggestedSubDepartmentId?: string }) => Promise<void>;
  adminLabel?: string;
}

export default function RevertGrievanceDialog({
  isOpen,
  grievanceId,
  onClose,
  onSubmit,
  adminLabel = 'Company Admin',
}: Props) {
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 🏢 Hierarchical Department State
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [selectedMainDept, setSelectedMainDept] = useState('');
  const [selectedSubDept, setSelectedSubDept] = useState('');

  const fetchDepts = useCallback(async () => {
    setLoadingDepts(true);
    try {
      const response = await departmentAPI.getAll({ limit: 100, listAll: true });
      if (response.success) {
        setDepartments(response.data.departments);
      }
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    } finally {
      setLoadingDepts(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRemarks('');
      setSelectedMainDept('');
      setSelectedSubDept('');
      fetchDepts();
    }
  }, [isOpen, fetchDepts]);

  // Filter departments for dropdowns
  const mainDepartments = departments.filter(d => !d.parentDepartmentId);
  const subDepartments = departments.filter(d => 
    d.parentDepartmentId && (
      typeof d.parentDepartmentId === 'string' 
        ? d.parentDepartmentId === selectedMainDept 
        : (d.parentDepartmentId as any)._id === selectedMainDept
    )
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-visible">
        <div className="bg-slate-900 px-5 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center">
              <Undo2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Revert </h3>
              <p className="text-[14px] text-slate-400 uppercase tracking-widest font-semibold">
                {`Send request to ${adminLabel}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Grievance ID</span>
            <span className="text-xs font-black text-slate-900 font-mono">{grievanceId || '-'}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="block text-[14px] font-black text-slate-500 uppercase tracking-wider mb-1 px-1">Suggested Dept <span className="text-slate-400 normal-case">(optional)</span></label>
              <SearchableSelect
                options={mainDepartments.map(d => ({ value: d._id, label: d.name }))}
                value={selectedMainDept}
                onValueChange={(value) => {
                  setSelectedMainDept(value);
                  setSelectedSubDept('');
                }}
                placeholder={loadingDepts ? 'Loading...' : 'Select Department'}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="block text-[14px] font-black text-slate-500 uppercase tracking-wider mb-1 px-1">Sub Dept <span className="text-slate-400 normal-case">(optional)</span></label>
              <SearchableSelect
                disabled={!selectedMainDept}
                options={subDepartments.map(d => ({ value: d._id, label: d.name }))}
                value={selectedSubDept}
                onValueChange={(value) => setSelectedSubDept(value)}
                placeholder={!selectedMainDept ? 'Select dept. first' : subDepartments.length === 0 ? 'No sub-depts' : 'Select Sub-Dept'}
              />
            </div>
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-500 uppercase tracking-wider mb-2 flex justify-between items-center">
              <span>Reason for Revert *</span>
              <span className={`text-[14px] font-bold ${remarks.length > 100 ? 'text-rose-500' : 'text-slate-400'}`}>
                {remarks.length}/100
              </span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              placeholder="Explain why this grievance should be reverted and which department/sub-department should handle it."
              className={`w-full bg-slate-50 border ${remarks.length > 100 ? 'border-rose-500 ring-1 ring-rose-500/20' : 'border-slate-200'} rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/50 transition-all resize-none`}
            />
            {remarks.length > 100 && (
              <p className="mt-1 text-[14px] font-bold text-rose-500 uppercase tracking-tight px-1 text-right">
                Character limit exceeded by {remarks.length - 100} characters
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 rounded-b-2xl">
          <button 
            onClick={onClose} 
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!remarks.trim() || submitting}
            title={remarks.length > 100 ? `Reason exceeds 100 characters (currently ${remarks.length})` : ''}
            onClick={async () => {
              if (remarks.length > 100) {
                toast.error('Reason exceeds 100 character limit');
                return;
              }
              setSubmitting(true);
              try {
                await onSubmit({ 
                  remarks: remarks.trim(), 
                  suggestedDepartmentId: selectedMainDept || undefined,
                  suggestedSubDepartmentId: selectedSubDept || undefined
                });
                onClose();
              } finally {
                setSubmitting(false);
              }
            }}
            className={`px-6 py-2 text-xs font-black bg-amber-600 text-white rounded-xl shadow-lg shadow-amber-600/20 hover:bg-amber-700 transition-all flex items-center justify-center ${(!remarks.trim() || submitting || remarks.length > 100) ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
