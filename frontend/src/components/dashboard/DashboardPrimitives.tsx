"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortIconProps = {
  sortConfig: {
    key: string;
    direction: "asc" | "desc" | null;
  };
  columnKey: string;
};

export const LoadingDots = () => (
  <span className="inline-flex items-center gap-1 ml-1 py-1">
    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]" />
    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]" />
    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" />
  </span>
);

export const SortIcon = ({ sortConfig, columnKey }: SortIconProps) => {
  if (sortConfig.key !== columnKey || !sortConfig.direction) {
    return (
      <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 transition-colors" />
    );
  }

  return sortConfig.direction === "asc" ? (
    <ArrowUp className="w-3 h-3 text-indigo-600 transition-all duration-200" />
  ) : (
    <ArrowDown className="w-3 h-3 text-indigo-600 transition-all duration-200" />
  );
};
