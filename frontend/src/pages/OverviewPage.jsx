import { AccountCard } from './AccountsPage.jsx';
import { TrendChart } from '../components/TrendChart.jsx';
import { TransactionPanel } from './TransactionsPage.jsx';

export function OverviewPage({ accounts, categories, transactions, selectedAccount, selectedAccountId, trend, month, onMonthChange, language, timeFormat, t, onSelectAccount, onAddAccount, onAddTransaction, onDeleteTransaction, onEditTransaction }) {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const accountTransactions = selectedAccount ? transactions.filter((item) => item.accountId === selectedAccount.id) : [];
  const monthTransactions = accountTransactions
    .filter((item) => item.transactionDate.startsWith(month))
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? ''));

  return <>
    <section className="page-heading">
      <div><div className="eyebrow">{t('brand')}</div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <label className="month-control"><span>{t('month')}</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} /></label>
    </section>

    <section className="account-section" aria-label={t('accounts')}>
      <div className="section-heading"><div><div className="eyebrow">{t('accounts')}</div><h2>{t('accountOverview')}</h2></div>
        {accounts.length > 0 && <button className="add-account-link" onClick={onAddAccount}><span>+</span>{t('addAccount')}</button>}
      </div>
      {accounts.length ? (
        <div className="summary-grid account-scroller">
          {accounts.map((account) => <AccountCard key={account.id} account={account} selected={account.id === selectedAccountId} transactions={transactions} locale={locale} onSelect={() => onSelectAccount(account)} />)}
        </div>
      ) : (
        <div className="account-empty"><p>{t('noAccounts')}</p><button className="primary-button first-account-button" onClick={onAddAccount}><span className="large-plus">+</span>{t('createFirstAccount')}</button></div>
      )}
    </section>

    {selectedAccount && <TrendChart account={selectedAccount} points={trend} t={t} locale={locale} />}
    <TransactionPanel items={monthTransactions} categories={categories} accounts={accounts} t={t} language={language} timeFormat={timeFormat} onDelete={onDeleteTransaction} onAdd={onAddTransaction} onEdit={onEditTransaction} account={selectedAccount} />
  </>;
}
