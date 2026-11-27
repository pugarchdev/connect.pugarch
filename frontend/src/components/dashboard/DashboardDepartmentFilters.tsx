import React from "react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Department } from "@/lib/api/department";

interface DepartmentFilters {
  mainDeptId: string;
  subDeptId: string;
}

interface DepartmentFiltersProps {
  allDepartments: Department[];
  onFiltersChange: (filters: DepartmentFilters) => void;
  getParentDepartmentId: (d: any) => string | null;
  currentFilters: DepartmentFilters;
  showSubDepartmentSelect?: boolean;
  showOnlySubDepartmentsInMainSelect?: boolean;
  allMainOptionLabel?: string;
  className?: string;
  mainPlaceholder?: string;
  subPlaceholder?: string;
}

export const DashboardDepartmentFilters: React.FC<DepartmentFiltersProps> = ({
  allDepartments,
  onFiltersChange,
  getParentDepartmentId,
  currentFilters,
  showSubDepartmentSelect = true,
  showOnlySubDepartmentsInMainSelect = false,
  allMainOptionLabel,
  className = "",
  mainPlaceholder = "🏢 Main Depts",
  subPlaceholder = "📍 Sub Depts",
}) => {
  const mainDeptOptions = [
    {
      value: "",
      label:
        allMainOptionLabel ||
        (showOnlySubDepartmentsInMainSelect
          ? "📍 All Assigned Sub Depts"
          : "🏢 All Main Depts"),
    },
    ...allDepartments
      .filter((d) =>
        showOnlySubDepartmentsInMainSelect
          ? !!getParentDepartmentId(d)
          : !getParentDepartmentId(d),
      )
      .map((dept) => ({
        value: dept._id,
        label: dept.name,
      })),
  ];

  const subDeptOptions = [
    { value: "", label: "📍 All Sub Depts" },
    ...allDepartments
      .filter((d) => getParentDepartmentId(d) === currentFilters.mainDeptId)
      .map((dept) => ({
        value: dept._id,
        label: dept.name,
      })),
  ];

  return (
    <div className={`grid grid-cols-1 min-[360px]:grid-cols-2 sm:flex sm:flex-row items-stretch sm:items-center gap-2 ${className}`}>
      <div className="flex-1 min-w-0 sm:min-w-[140px] lg:min-w-[180px]">
        <SearchableSelect
          options={mainDeptOptions}
          value={currentFilters.mainDeptId}
          onValueChange={(val) =>
            onFiltersChange({ mainDeptId: val, subDeptId: "" })
          }
          placeholder={mainPlaceholder}
          className="w-full"
          triggerClassName="h-8 px-2.5 sm:px-3 group-hover:border-indigo-300 transition-all text-xs w-full sm:max-w-[150px] whitespace-normal break-words leading-tight flex items-center justify-between"
        />
      </div>
      {showSubDepartmentSelect && (
        <div className="flex-1 min-w-0 sm:min-w-[140px] lg:min-w-[180px]">
          <SearchableSelect
            options={subDeptOptions}
            value={currentFilters.subDeptId}
            onValueChange={(val) =>
              onFiltersChange({ ...currentFilters, subDeptId: val })
            }
            disabled={!currentFilters.mainDeptId}
            placeholder={subPlaceholder}
            className="w-full"
            triggerClassName="h-8 px-2.5 sm:px-3 group-hover:border-indigo-300 transition-all text-xs w-full sm:max-w-[150px] whitespace-normal break-words leading-tight flex items-center justify-between"
          />
        </div>
      )}
    </div>
  );
};
