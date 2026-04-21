import { type Dictionary } from "./dictionary";

// French — source of truth. Every other locale falls back here on missing keys.
export const fr: Dictionary = {
  brand: {
    tagline: "La plateforme événementielle du Sénégal",
    footer: "Teranga Events — La plateforme événementielle du Sénégal",
  },
  common: {
    greeting: (name) => `Bonjour ${name},`,
    signoff: "L'équipe Teranga",
    viewInApp: "Voir dans l'application",
  },
  registrationConfirmation: {
    subject: (eventTitle) => `Inscription confirmée — ${eventTitle}`,
    preview: (eventTitle) => `Votre inscription à ${eventTitle} est confirmée.`,
    heading: "Inscription confirmée !",
    body: (eventTitle) => `Votre inscription à ${eventTitle} est confirmée.`,
    dateLabel: "Date",
    locationLabel: "Lieu",
    ticketLabel: "Billet",
    downloadBadgeCta: "Télécharger mon badge",
    badgeInAppHint: "Votre badge QR sera disponible dans l'application.",
  },
  registrationApproved: {
    subject: (eventTitle) => `Inscription approuvée — ${eventTitle}`,
    preview: "Votre inscription a été approuvée par l'organisateur.",
    heading: "Inscription approuvée !",
    body: (eventTitle) => `Votre inscription à ${eventTitle} a été approuvée par l'organisateur.`,
    dateLabel: "Date",
    locationLabel: "Lieu",
    downloadBadgeCta: "Télécharger mon badge",
    badgeInAppHint: "Votre badge QR sera disponible dans l'application.",
  },
  badgeReady: {
    subject: (eventTitle) => `Votre badge est prêt — ${eventTitle}`,
    preview: "Votre badge est prêt à être téléchargé.",
    heading: "Votre badge est prêt !",
    body: (eventTitle) => `Votre badge pour ${eventTitle} est prêt à être téléchargé.`,
    downloadBadgeCta: "Télécharger mon badge",
    badgeInAppHint: "Ouvrez l'application Teranga pour télécharger votre badge.",
  },
  eventReminder: {
    subject: (eventTitle, timeUntil) => `Rappel — ${eventTitle} ${timeUntil}`,
    preview: (eventTitle) => `${eventTitle} commence bientôt.`,
    heading: (timeUntil) => `Rappel : ${timeUntil}`,
    body: (eventTitle, timeUntil) => `${eventTitle} commence ${timeUntil} !`,
    dateLabel: "Date",
    locationLabel: "Lieu",
    dontForgetBadge: "N'oubliez pas votre badge QR !",
  },
  eventCancelled: {
    subject: (eventTitle) => `Événement annulé — ${eventTitle}`,
    preview: "Un événement auquel vous êtes inscrit a été annulé.",
    heading: "Événement annulé",
    body: (eventTitle, eventDate) =>
      `Nous sommes désolés de vous informer que l'événement ${eventTitle} prévu le ${eventDate} a été annulé.`,
    contactOrganizer:
      "Si vous avez des questions, veuillez contacter l'organisateur de l'événement.",
  },
  paymentReceipt: {
    subject: (amount) => `Reçu de paiement — ${amount}`,
    preview: (amount) => `Nous avons reçu votre paiement de ${amount}.`,
    heading: "Paiement confirmé",
    body: (amount, eventTitle) =>
      `Nous avons bien reçu votre paiement de ${amount} pour ${eventTitle}.`,
    amountLabel: "Montant",
    eventLabel: "Événement",
    receiptIdLabel: "Référence",
    dateLabel: "Date",
    thankYou: "Merci de votre confiance. À bientôt !",
  },
  welcomeNewsletter: {
    subject: "Bienvenue sur Teranga Events !",
    preview: "Votre inscription à la newsletter est confirmée.",
    heading: "Bienvenue !",
    body: "Votre inscription à notre newsletter a bien été enregistrée.",
    closing:
      "Vous recevrez des informations sur les prochains événements au Sénégal et en Afrique de l'Ouest.",
    unsubscribeNote:
      "Vous recevez cet e-mail parce que vous vous êtes inscrit à la newsletter Teranga Events. Vous pouvez vous désinscrire à tout moment.",
  },
};
