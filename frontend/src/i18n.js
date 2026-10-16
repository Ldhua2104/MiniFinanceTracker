const messages = {
  en: {
    home: 'Home', budgets: 'Budgets', settings: 'Settings', accounts: 'Accounts', accountOverview: 'Your accounts',
    addAccount: 'Add account', noAccounts: 'Add an account to start organizing your money.', createFirstAccount: 'Create your first account',
    fiveDayTrend: 'Five-day cash flow', selectedAccount: 'Selected account', accountSetupHint: 'Set a name, opening amount and currency for this account.',
    accountName: 'Account name', openingBalance: 'Opening amount', saveAccount: 'Save account', cancel: 'Cancel', close: 'Close',
    chooseAccountFirst: 'Create or select an account before adding a transaction.', activityHint: 'Review this month’s activity for the selected account.',
    comingSoon: 'This section is ready for a future update.', settingsHint: 'Choose how Mint Finance looks and reads.', languageHint: 'Select the interface language.', themeHint: 'Choose a light or dark appearance.',
    brand: 'MINT FINANCE', title: 'Personal finance, in clear view.', subtitle: 'A quiet space to understand your spending and stay close to your plans.',
    overview: 'Overview', activity: 'Activity', profile: 'Profile', month: 'Month', income: 'Income', expense: 'Spending', balance: 'Net balance',
    newTransaction: 'Add transaction', type: 'Type', category: 'Category', amount: 'Amount', date: 'Date', note: 'Note', save: 'Save transaction',
    incomeType: 'Income', expenseType: 'Expense', recent: 'Recent activity', empty: 'No transactions for this month yet.',
    anonymous: 'Anonymous workspace', localNote: 'Your data stays in this browser until you choose to sign in.', account: 'Account',
    signIn: 'Sign in', register: 'Create account', email: 'Email address', password: 'Password', confirmPassword: 'Confirm password',
    signOut: 'Sign out', language: 'Language', theme: 'Appearance', light: 'Light', dark: 'Dark', security: 'Your account',
    secureNote: 'Use an email and a password with at least 12 characters.', already: 'Already have an account?', noAccount: 'New to Mint Finance?',
    switchLogin: 'Sign in', switchRegister: 'Create an account', authFailed: 'Could not authenticate. Check your details and try again.',
    passwordMismatch: 'Passwords do not match.', passwordShort: 'Use at least 12 characters.', migrationTitle: 'Local data found',
    migrationText: 'Choose how to continue. Merging uploads your anonymous workspace to this account.', merge: 'Merge local data', keepServer: 'Use account data',
    saved: 'Saved', saveFailed: 'Could not save your data. Please try again.', roleUser: 'Member account', roleAnonymous: 'Anonymous',
    currency: 'Currency', delete: 'Delete', fieldRequired: 'Please complete the required fields.',
    confirmDelete: 'Delete this transaction? This cannot be undone.',
    footer: 'Personal finance, kept simple', overviewHint: 'Your monthly picture at a glance', transactionsCount: 'transactions'
  },
  zh: {
    home: '首页', budgets: '预算', settings: '设置', accounts: '账户', accountOverview: '账户总览',
    addAccount: '添加账户', noAccounts: '添加账户，开始整理收支。', createFirstAccount: '创建第一个账户',
    fiveDayTrend: '近五日收支', selectedAccount: '当前账户', accountSetupHint: '为账户设置名称、初始金额和币种。',
    accountName: '账户名称', openingBalance: '初始金额', saveAccount: '保存账户', cancel: '取消', close: '关闭',
    chooseAccountFirst: '请先创建或选择账户，再添加交易。', activityHint: '查看当前账户本月收支记录。',
    comingSoon: '此页面将在后续版本开放。', settingsHint: '设置 Mint Finance 的显示方式。', languageHint: '选择界面语言。', themeHint: '选择浅色或深色外观。',
    brand: 'MINT FINANCE', title: '收支清晰，心里有数。', subtitle: '用一处安静、简单的空间，了解日常支出并照顾好计划。',
    overview: '概览', activity: '收支记录', profile: '个人资料', month: '月份', income: '收入', expense: '支出', balance: '收支结余',
    newTransaction: '添加一笔收支', type: '类型', category: '分类', amount: '金额', date: '日期', note: '备注', save: '保存记录',
    incomeType: '收入', expenseType: '支出', recent: '最近记录', empty: '本月还没有收支记录。',
    anonymous: '匿名空间', localNote: '登录前，数据只保存在当前浏览器中。', account: '账户',
    signIn: '登录', register: '创建账户', email: '邮箱地址', password: '密码', confirmPassword: '再次输入密码',
    signOut: '退出登录', language: '语言', theme: '外观', light: '浅色', dark: '深色', security: '账户设置',
    secureNote: '使用邮箱注册，密码至少 12 个字符。', already: '已经有账户？', noAccount: '第一次使用？',
    switchLogin: '去登录', switchRegister: '创建账户', authFailed: '验证失败，请检查邮箱和密码后重试。',
    passwordMismatch: '两次输入的密码不一致。', passwordShort: '密码至少需要 12 个字符。', migrationTitle: '发现本地数据',
    migrationText: '选择继续方式。合并会将匿名空间的数据上传到当前账户。', merge: '合并本地数据', keepServer: '使用账户数据',
    saved: '已保存', saveFailed: '保存失败，请重试。', roleUser: '已登录账户', roleAnonymous: '匿名使用',
    currency: '币种', delete: '删除', fieldRequired: '请填写必填项目。',
    confirmDelete: '\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u4ea4\u6613\u5417\uff1f\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002',
    footer: '简单记录，安心生活', overviewHint: '快速了解本月收支', transactionsCount: '笔记录'
  }
};

export function detectLanguage() {
  const saved = localStorage.getItem('mini-finance.language');
  if (saved === 'en' || saved === 'zh') return saved;
  return navigator.languages?.some((language) => language.toLowerCase().startsWith('zh')) || navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translate(language, key) {
  return messages[language]?.[key] ?? messages.en[key] ?? key;
}

export function saveLanguage(language) {
  localStorage.setItem('mini-finance.language', language);
}
