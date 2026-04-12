"use client";

import { useState, useCallback } from "react";
import { Button } from "@teranga/shared-ui";
import { Download, Loader2 } from "lucide-react";

export interface CsvColumn {
  key: string;
  header: string;
}

export interface CsvExportButtonProps {
  data: Record<string, unknown>[];
  columns: CsvColumn[];
  filename?: string;
  className?: string;
}

/**
 * Escape a CSV field value.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 * Doubles any existing double-quote characters.
 */
function escapeCSVField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate a CSV string from data rows and column definitions.
 * Includes BOM prefix for Excel UTF-8 compatibility.
 */
function generateCSV(data: Record<string, unknown>[], columns: CsvColumn[]): string {
  const headerRow = columns.map((col) => escapeCSVField(col.header)).join(",");

  const dataRows = data.map((row) =>
    columns
      .map((col) => {
        const value = row[col.key];
        if (value == null) return "";
        return escapeCSVField(String(value));
      })
      .join(","),
  );

  const csvContent = [headerRow, ...dataRows].join("\r\n");

  // BOM prefix for Excel UTF-8 compatibility
  return "\uFEFF" + csvContent;
}

/**
 * Trigger a browser download of a CSV file.
 */
function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Reusable CSV export button component.
 *
 * Generates a CSV from the provided data and column definitions,
 * then triggers a browser download. Shows a loading spinner during
 * generation for large datasets.
 */
export function CsvExportButton({ data, columns, filename, className }: CsvExportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = useCallback(() => {
    setIsGenerating(true);
    try {
      const csv = generateCSV(data, columns);
      const date = new Date().toISOString().slice(0, 10);
      const resolvedFilename = filename ? `${filename}.csv` : `export-${date}.csv`;
      triggerDownload(csv, resolvedFilename);
    } finally {
      // Use setTimeout to allow the UI to show the loading state
      // briefly even for small datasets, providing visual feedback
      setTimeout(() => setIsGenerating(false), 200);
    }
  }, [data, columns, filename]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isGenerating || data.length === 0}
      className={className}
      title="Exporter les données au format CSV"
      aria-label="Exporter CSV"
    >
      {isGenerating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-1.5" />
      )}
      Exporter CSV
    </Button>
  );
}
