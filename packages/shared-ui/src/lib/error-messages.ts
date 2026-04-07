const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Vous devez être connecté(e) pour effectuer cette action.",
  FORBIDDEN: "Vous n'avez pas les permissions nécessaires.",
  NOT_FOUND: "La ressource demandée est introuvable.",
  VALIDATION_ERROR: "Les données saisies sont invalides. Veuillez vérifier le formulaire.",
  CONFLICT: "Cette action est en conflit avec l'état actuel.",
  QUOTA_EXCEEDED: "Votre quota a été atteint.",
  EVENT_FULL: "Cet événement est complet.",
  REGISTRATION_CLOSED: "Les inscriptions sont fermées pour cet événement.",
  QR_INVALID: "Le code QR est invalide.",
  QR_ALREADY_USED: "Ce badge a déjà été scanné.",
  ORGANIZATION_PLAN_LIMIT: "Limite de votre plan atteinte.",
  RATE_LIMIT_EXCEEDED: "Trop de requêtes. Veuillez patienter quelques instants.",
  TIMEOUT: "La requête a expiré. Vérifiez votre connexion.",
  INTERNAL_ERROR: "Une erreur inattendue s'est produite.",
};

/**
 * Returns a user-friendly French error message for the given API error code.
 * Falls back to the provided message, then to a generic error.
 */
export function getErrorMessage(code?: string, fallbackMessage?: string): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  return fallbackMessage ?? "Une erreur est survenue. Veuillez réessayer.";
}
