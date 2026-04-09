import type { Registration } from "@teranga/shared-types";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirme",
  pending: "En attente",
  pending_payment: "Paiement en attente",
  waitlisted: "Liste d'attente",
  cancelled: "Annule",
  checked_in: "Entre",
  payment_failed: "Paiement echoue",
};

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
 * Convert an array of Registration objects to a CSV string with French headers.
 * Includes BOM prefix for Excel UTF-8 compatibility.
 */
export function registrationsToCSV(registrations: Registration[]): string {
  const headers = [
    "ID inscription",
    "Participant (ID)",
    "Type de billet",
    "Statut",
    "Date d'inscription",
    "Check-in",
    "Date check-in",
    "Notes",
  ];

  const rows = registrations.map((reg) => [
    escapeCSVField(reg.id),
    escapeCSVField(reg.userId),
    escapeCSVField(reg.ticketTypeName ?? reg.ticketTypeId),
    escapeCSVField(STATUS_LABELS[reg.status] ?? reg.status),
    escapeCSVField(formatDateForCSV(reg.createdAt)),
    reg.checkedInAt ? "Oui" : "Non",
    reg.checkedInAt ? escapeCSVField(formatDateForCSV(reg.checkedInAt)) : "",
    escapeCSVField(reg.notes ?? ""),
  ]);

  const csvContent = [
    headers.map(escapeCSVField).join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\r\n");

  // BOM prefix for Excel UTF-8 compatibility
  return "\uFEFF" + csvContent;
}

function formatDateForCSV(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

/**
 * Trigger a browser download of a CSV file.
 */
export function downloadCSV(content: string, filename: string): void {
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
