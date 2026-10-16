export const CURRENCIES = Object.freeze(['USD', 'EUR', 'CNY', 'GBP']);
export const USER_ROLES = Object.freeze(['user', 'admin']);
// anonymous is a client-only role: anonymous workspaces are never authenticated or stored on the server.
export const APP_ROLES = Object.freeze(['anonymous', ...USER_ROLES]);
export const USER_STATUSES = Object.freeze(['active', 'disabled']);
export const TRANSACTION_TYPES = Object.freeze(['income', 'expense']);
export const ANALYSIS_STATUSES = Object.freeze(['pending', 'processing', 'completed', 'failed']);
export const EMAIL_JOB_STATUSES = Object.freeze(['pending', 'processing', 'accepted', 'failed', 'skipped']);
export const NOTIFICATION_THRESHOLDS = Object.freeze([80, 100]);
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
