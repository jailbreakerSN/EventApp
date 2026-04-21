import { type Dictionary } from "./dictionary";

// French — source of truth. Every other locale falls back here on missing keys.
export const fr: Dictionary = {
  lang: "fr",
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
    unsubscribeLinkLabel: "Se désinscrire",
  },
  newsletterConfirmation: {
    subject: "Confirmez votre inscription à la newsletter Teranga",
    preview: "Un dernier clic pour recevoir nos actualités événementielles.",
    heading: "Confirmez votre inscription",
    body: "Merci de votre intérêt pour Teranga Events ! Pour finaliser votre inscription à notre newsletter, confirmez votre adresse e-mail en cliquant sur le bouton ci-dessous.",
    ctaButton: "Confirmer mon inscription",
    expiryNote: "Ce lien expire dans 7 jours.",
    didNotSubscribeNote:
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — aucune inscription ne sera créée sans confirmation.",
    fallbackLine: (url) =>
      `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${url}`,
  },
  emailVerification: {
    subject: "Confirmez votre adresse e-mail Teranga",
    preview: "Cliquez pour vérifier votre adresse e-mail.",
    heading: (name) => `Bienvenue ${name} !`,
    body: "Pour finaliser la création de votre compte Teranga, nous avons besoin de confirmer votre adresse e-mail. Cliquez sur le bouton ci-dessous pour activer votre compte.",
    ctaButton: "Confirmer mon adresse",
    expiryNote: "Ce lien expire dans 1 heure.",
    didNotRequestNote:
      "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet e-mail — votre adresse ne sera liée à aucun compte.",
    fallbackLine: (url) =>
      `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${url}`,
  },
  passwordReset: {
    subject: "Réinitialisation de votre mot de passe Teranga",
    preview: "Cliquez pour choisir un nouveau mot de passe.",
    heading: "Réinitialisez votre mot de passe",
    body: "Nous avons reçu une demande de réinitialisation du mot de passe associé à cette adresse e-mail. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.",
    ctaButton: "Choisir un nouveau mot de passe",
    expiryNote: "Ce lien expire dans 1 heure.",
    didNotRequestNote:
      "Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail et vérifiez la sécurité de votre compte. Votre mot de passe actuel reste inchangé.",
    fallbackLine: (url) =>
      `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${url}`,
  },
};
