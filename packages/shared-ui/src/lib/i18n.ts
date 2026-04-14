/**
 * Shared-UI localisation dictionary.
 *
 * Each component in `@teranga/shared-ui` that renders user-facing text
 * accepts an optional `labels` prop (or individual string props) with
 * French defaults baked in. Consumers wire these up to their i18n
 * runtime (next-intl, react-i18next, etc.) by passing translated
 * strings per render.
 *
 * Rationale (TASK-P1-I1a):
 * shared-ui must not hard-code locale. Hoisting the strings into a
 * typed dictionary lets every consumer app plug in its own
 * translation runtime without forcing one specific i18n framework on
 * the shared package. French defaults preserve backward compat for
 * call-sites that have not yet wired localisation.
 *
 * Usage:
 *
 * ```tsx
 * // Option A — per-prop (most common, minimal refactor):
 * <Pagination
 *   currentPage={page}
 *   totalPages={total}
 *   onPageChange={setPage}
 *   ariaLabel={t("ui.pagination.label")}
 *   previousLabel={t("ui.pagination.prev")}
 *   nextLabel={t("ui.pagination.next")}
 * />
 *
 * // Option B — bundle dictionary (for apps that centralise translations):
 * const uiLabels = buildTerangaUILocale(t);
 * <Pagination {...props} labels={uiLabels.pagination} />
 * ```
 */

/** Pagination labels. */
export interface PaginationLabels {
  /** aria-label for the <nav> region. Default: "Pagination". */
  navigation: string;
  /** aria-label on the previous-page button. Default: "Page précédente". */
  previous: string;
  /** aria-label on the next-page button. Default: "Page suivante". */
  next: string;
  /**
   * Builder for the numbered page buttons' aria-label.
   * Default: `(n) => \`Page ${n}\``.
   */
  page: (n: number) => string;
}

/** Dialog (and ConfirmDialog close-button) labels. */
export interface DialogLabels {
  /** aria-label on the × close button. Default: "Fermer". */
  close: string;
}

/** FileUpload labels. */
export interface FileUploadLabels {
  /** Visible drop-zone instruction. Default: "Glissez un fichier ici". */
  dropzone: string;
  /** Error shown when an invalid MIME type is dropped. Default: "Type de fichier non accepté". */
  invalidType: string;
  /** aria-label on the per-file remove button. Default: "Supprimer le fichier". */
  remove: string;
}

/** OfflineBanner labels. */
export interface OfflineBannerLabels {
  /** Full banner message. Default: "Connexion perdue. Certaines fonctionnalités peuvent être indisponibles." */
  message: string;
}

/** Toaster aria region. */
export interface ToasterLabels {
  /** aria-label on the toast region. Default: "Notifications". */
  region: string;
}

/** DataTable labels. */
export interface DataTableLabels {
  /** Default empty message. Default: "Aucune donnée". */
  empty: string;
}

/** QueryError labels. */
export interface QueryErrorLabels {
  /** Heading text. Default: "Erreur de chargement". */
  title: string;
  /** Body text. Default: "Une erreur est survenue lors du chargement des données." */
  message: string;
  /** Retry button text. Default: "Réessayer". */
  retry: string;
}

/** ConfirmDialog labels. */
export interface ConfirmDialogLabels {
  /** Confirm button. Default: "Confirmer". */
  confirm: string;
  /** Cancel button. Default: "Annuler". */
  cancel: string;
}

/**
 * Full shared-UI locale dictionary. Every key is optional at the
 * component level — pass a partial bundle and unknown keys fall
 * through to the French defaults.
 */
export interface TerangaUILocale {
  pagination: PaginationLabels;
  dialog: DialogLabels;
  fileUpload: FileUploadLabels;
  offlineBanner: OfflineBannerLabels;
  toaster: ToasterLabels;
  dataTable: DataTableLabels;
  queryError: QueryErrorLabels;
  confirmDialog: ConfirmDialogLabels;
}

/** French defaults — used when a caller does not override. */
export const DEFAULT_UI_LOCALE_FR: TerangaUILocale = {
  pagination: {
    navigation: "Pagination",
    previous: "Page précédente",
    next: "Page suivante",
    page: (n) => `Page ${n}`,
  },
  dialog: {
    close: "Fermer",
  },
  fileUpload: {
    dropzone: "Glissez un fichier ici",
    invalidType: "Type de fichier non accepté",
    remove: "Supprimer le fichier",
  },
  offlineBanner: {
    message: "Connexion perdue. Certaines fonctionnalités peuvent être indisponibles.",
  },
  toaster: {
    region: "Notifications",
  },
  dataTable: {
    empty: "Aucune donnée",
  },
  queryError: {
    title: "Erreur de chargement",
    message: "Une erreur est survenue lors du chargement des données.",
    retry: "Réessayer",
  },
  confirmDialog: {
    confirm: "Confirmer",
    cancel: "Annuler",
  },
};
