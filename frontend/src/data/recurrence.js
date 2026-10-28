const AUTO_NOTE = '\u6bcf\u6708\u81ea\u52a8\u6dfb\u52a0\u81ea\u52a8\u6dfb\u52a0\uff0c\u91d1\u989d\u53d8\u52a8\uff1a';
const SCHEDULES = new Set(['month-start', 'month-end', 'same-day', 'custom']);

function formatDate(year, monthIndex, day) {
    const date = new Date(year, monthIndex, day, 12);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextMonthlyDate(referenceDate, schedule, dayOfMonth = 1) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate || '') || !SCHEDULES.has(schedule)) return '';
    const [year, month] = referenceDate.split('-').map(Number);
    const targetMonth = month;
    const lastDay = new Date(year, targetMonth + 1, 0).getDate();
    const day = schedule === 'month-start' ? 1
        : schedule === 'month-end' ? lastDay
            : Math.min(Math.max(Number(dayOfMonth) || 1, 1), lastDay);
    return formatDate(year, targetMonth, day);
}

export function makeMonthlyRecurrence(schedule, dayOfMonth, time, fromDate) {
    if (!SCHEDULES.has(schedule) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return null;
    const day = ['custom', 'same-day'].includes(schedule) ? Number(dayOfMonth) : undefined;
    if (['custom', 'same-day'].includes(schedule) && (!Number.isInteger(day) || day < 1 || day > 31)) return null;
    return {
        enabled: true,
        schedule,
        ...(day ? { dayOfMonth: day } : {}),
        time,
        nextRunDate: nextMonthlyDate(fromDate, schedule, day)
    };
}

export function materializeDueRecurringTransactions(data, throughDate) {
    let changed = false;
    const additions = [];
    const transactions = data.transactions.map((transaction) => {
        const recurring = transaction.recurring;
        if (!recurring?.enabled || !SCHEDULES.has(recurring.schedule)) return transaction;

        let nextRunDate = recurring.nextRunDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextRunDate || '')) {
            nextRunDate = nextMonthlyDate(throughDate, recurring.schedule, recurring.dayOfMonth);
            changed = true;
        }

        while (nextRunDate && nextRunDate <= throughDate) {
            const recurrenceMonth = nextRunDate.slice(0, 7);
            const exists = data.transactions.some((item) => item.recurrenceSourceId === transaction.id && item.recurrenceMonth === recurrenceMonth)
                || additions.some((item) => item.recurrenceSourceId === transaction.id && item.recurrenceMonth === recurrenceMonth);
            if (!exists) {
                const { noteImage, noteImages, recurring: sourceRule, recurrenceSourceId, recurrenceMonth: sourceMonth, ...source } = transaction;
                additions.push({
                    ...source,
                    id: crypto.randomUUID(),
                    transactionDate: nextRunDate,
                    transactionTime: recurring.time || transaction.transactionTime || '',
                    note: AUTO_NOTE,
                    recurrenceSourceId: transaction.id,
                    recurrenceMonth
                });
            }
            nextRunDate = nextMonthlyDate(nextRunDate, recurring.schedule, recurring.dayOfMonth);
            changed = true;
        }

        return nextRunDate === recurring.nextRunDate ? transaction : { ...transaction, recurring: { ...recurring, nextRunDate } };
    });

    return changed ? { ...data, transactions: [...transactions, ...additions] } : data;
}
