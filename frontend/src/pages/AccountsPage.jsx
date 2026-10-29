import { useState } from 'react';
import { centsToAmount, currencies, currencySymbol, formatSignedCents, moneyToCents } from '../utils/finance.js';

export function AccountCard({ account, selected, transactions, locale, onSelect }) {
    const balance = transactions.filter((item) => item.accountId === account.id).reduce((sum, item) => {
        const cents = moneyToCents(item.amount) ?? 0n;
        return sum + (item.type === 'income' ? cents : -cents);
    }, moneyToCents(account.openingBalance) ?? 0n);
    return (
        <button className={`account-card-option ${selected ? 'selected' : ''}`} onClick={onSelect}>
            <span className="account-card-top"><span className="account-glyph">{account.name.slice(0, 1).toUpperCase()}</span><span className="account-currency">{account.currency}</span></span>
            <span className="account-name">{account.name}</span>
            <strong>{formatSignedCents(balance, locale, account.currency)}</strong>
        </button>
    );
}

export function AccountForm({ t, onCancel, onSubmit, onDelete, initialAccount = null, draftAccount = null, embedded = false }) {
    const editing = Boolean(initialAccount);
    const values = initialAccount ?? draftAccount;
    const [currency, setCurrency] = useState(values?.currency ?? 'USD');
    const [error, setError] = useState('');
    function submit(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const name = String(form.get('name')).trim();
        const note = String(form.get('note') ?? '').trim();
        const openingBalance = editing ? initialAccount.openingBalance : String(form.get('openingBalance')).trim() || '0.00';
        if (!name || (!editing && moneyToCents(openingBalance) === null)) return setError(t('fieldRequired'));
        setError('');
        onSubmit({ id: initialAccount?.id ?? draftAccount?.id ?? crypto.randomUUID(), name, note, currency, openingBalance: editing ? openingBalance : centsToAmount(moneyToCents(openingBalance)) });
    }
    const fields = <>
        <label className="field">
            <span>{t('accountName')}</span>
            <input name="name" type="text" maxLength="60" defaultValue={values?.name ?? ''} autoFocus={!embedded} required />
        </label>
        {!editing &&
            <label className="field">
                <span>{t('openingBalance')}</span>
                <div className="transaction-amount-input">
                    <span>{currencySymbol(currency)}</span>
                    <input name="openingBalance" type="number" min="0" step="0.01" defaultValue={draftAccount?.openingBalance ?? '0.00'} required /></div>
            </label>}
        <label className="field">
            <span>{t('currency')}</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select>
        </label>
        <label className="field">
            <span>{t('accountNote')}</span>
            <textarea name="note" rows="3" maxLength="500" defaultValue={values?.note ?? ''} />
        </label>
        {error && <div className="inline-error">{error}</div>}
    </>;

    if (embedded) return <section className="inline-account-editor">
        <div className="inline-budget-heading"><strong>{t('addAccount')}</strong><button type="button" className="text-button" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <form onSubmit={submit}>{fields}<button className="primary-button" type="submit">{t('saveAccount')} <span>+</span></button></form>
    </section>;

    return (
        <section className="panel side-editor account-editor">
            <div className="editor-heading">
                <div>
                    <div className="eyebrow">{t('accounts')}</div>
                    <h2>{t(editing ? 'editAccount' : 'addAccount')}</h2>
                </div>
                <button className="icon-button close-editor" type="button" onClick={onCancel} aria-label={t('close')}>×</button>
            </div>
            <p className="editor-copy">{t('accountSetupHint')}</p>
            <form onSubmit={submit}>
                {fields}
                <div className="transaction-form-actions"><button className="primary-button" type="submit">{t('saveAccount')}</button>{editing && <button className="delete-transaction-button" type="button" onClick={() => { if (window.confirm(t('confirmDeleteAccount'))) onDelete(initialAccount.id); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l-1-13M10 11v5m4-5v5" /></svg><span>{t('deleteAccount')}</span></button>}</div>
            </form>
        </section>
    );
}
