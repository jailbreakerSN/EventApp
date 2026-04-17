export { Button, buttonVariants, type ButtonProps } from "./components/button";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "./components/card";
export { Input, type InputProps } from "./components/input";
export { Select, type SelectProps } from "./components/select";
export { Textarea, type TextareaProps } from "./components/textarea";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { Spinner } from "./components/spinner";
export { Toaster } from "./components/toaster";
export { ConfirmDialog } from "./components/confirm-dialog";
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
export { Skeleton, type SkeletonProps } from "./components/skeleton";
export { FormField, type FormFieldProps } from "./components/form-field";
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./components/breadcrumb";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  alertVariants,
  type AlertProps,
} from "./components/alert";
export { cn, formatDate, formatDateTime, formatCurrency } from "./lib/utils";
export { getErrorMessage } from "./lib/error-messages";
export { getStatusVariant } from "./lib/status-variants";
export { ThemeToggle } from "./components/theme-toggle";
export { LogoLoader } from "./components/logo-loader";
export { EmptyState, type EmptyStateProps } from "./components/empty-state";
export { QueryError, type QueryErrorProps } from "./components/query-error";
export { OfflineBanner } from "./components/offline-banner";
export { Avatar, avatarVariants, type AvatarProps } from "./components/avatar";
export { Tooltip, type TooltipProps } from "./components/tooltip";
export { Switch, type SwitchProps } from "./components/switch";
export { Pagination, type PaginationProps } from "./components/pagination";
export { SearchInput, type SearchInputProps } from "./components/search-input";
export { FileUpload, type FileUploadProps } from "./components/file-upload";
export { DataTable, type DataTableProps, type DataTableColumn } from "./components/data-table";
export { RadioGroup, type RadioGroupProps, type RadioOption } from "./components/radio-group";
export { SectionHeader, type SectionHeaderProps } from "./components/section-header";
export { Stepper, type StepperProps, type StepperStep } from "./components/stepper";

// ─── i18n ─────────────────────────────────────────────────────────────────
export {
  DEFAULT_UI_LOCALE_FR,
  type TerangaUILocale,
  type PaginationLabels,
  type DialogLabels,
  type FileUploadLabels,
  type OfflineBannerLabels,
  type ToasterLabels,
  type DataTableLabels,
  type QueryErrorLabels,
  type ConfirmDialogLabels,
} from "./lib/i18n";
export { LanguageSwitcher, DEFAULT_LOCALES, type LanguageSwitcherProps, type LanguageOption } from "./components/language-switcher";
