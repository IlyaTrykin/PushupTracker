/**
 * Feedback type (G05): «Ошибка / Идея / Жалоба» in the feedback sheet; the type goes to the mail subject.
 * Used as `feedbackTypeMessages[locale]`; the keys of `types` match `FEEDBACK_TYPES` in `src/lib/feedback.ts`.
 */
export const feedbackTypeMessages = {
  ru: {
    typeLabel: 'Тип обращения',
    types: {
      bug: 'Ошибка',
      idea: 'Идея',
      complaint: 'Жалоба',
    },
    complaintInfo: 'Жалоба на конкретного человека — в его карточке в «Друзьях» или в группе: так она сразу попадёт к модератору вместе с профилем.',
    tooMany: 'Слишком много сообщений. Попробуйте через минуту.',
  },
  en: {
    typeLabel: 'Type',
    types: {
      bug: 'Bug',
      idea: 'Idea',
      complaint: 'Complaint',
    },
    complaintInfo: 'To report a specific person, use their card in «Friends» or in a group: the report reaches the moderator together with the profile.',
    tooMany: 'Too many messages. Try again in a minute.',
  },
} as const;
