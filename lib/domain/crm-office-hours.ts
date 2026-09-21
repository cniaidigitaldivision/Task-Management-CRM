/**
 * 10 AM – 6 PM, Monday to Saturday: the office's own week.
 *
 * Shared by the booking screen (appointment-scheduler) and the AI agent's free
 * times (crm-agent-slots), so a person and the agent book the same week.
 */
export const OFFICE = { from: 10, to: 18, days: [1, 2, 3, 4, 5, 6] } as const;
