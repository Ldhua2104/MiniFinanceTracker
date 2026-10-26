const messages = {
    en: {
        home: 'Home', budgets: 'Budgets', settings: 'Settings', accounts: 'Accounts', accountOverview: 'Your accounts', activitySummary: 'Monthly totals', summaryCurrency: 'Display currency', ratesLoading: 'Loading exchange rates…', ratesUnavailable: 'Exchange rates unavailable', ratesCached: 'Using cached exchange rates', ratesThrough: 'Rates through', refreshRates: 'Refresh exchange rates', filterTransactions: 'Filter transactions', transactionType: 'Transaction type', allTransactionTypes: 'All types', filterIncomeSource: 'Income source', allSources: 'All sources', filterAutoAdd: 'Automatic entries', allRecurringTypes: 'All entries', recurringOnly: 'Automatic only', nonRecurringOnly: 'Manual only', dateRange: 'Date range', startDate: 'From date', endDate: 'To date', amountRange: 'Amount range', minimumAmount: 'Minimum', maximumAmount: 'Maximum', filterBudget: 'Budget', allBudgets: 'All budgets', filterAccount: 'Account', clearFilters: 'Clear filters', noMatchingTransactions: 'No transactions match these filters.',
        budgetIntro: 'Set a monthly limit for each spending category and keep track of what remains.', monthlyBudgets: 'Monthly budgets', budgetsCount: 'budgets', addBudget: 'Add budget', noBudgets: 'No budgets yet. Add one to set a monthly spending limit.',
        remainingBudget: 'Available', totalBudget: 'Monthly limit', budgetProgress: 'spent', spentBudget: 'Spent', monthEnds: 'Through', editBudget: 'Edit budget', budgetDetails: 'details', remainingBudgetTrend: 'Remaining budget this month', accountSpendingShare: 'Spending by account', noBudgetSpending: 'No related spending this month.', recentBudgetTransactions: 'Latest five expenses', unassignedAccount: 'Unassigned account', budgetEditorHint: 'Choose a category name, a monthly amount, a default currency and a card color. The budget includes matching transactions from all accounts.', budgetName: 'Budget name', monthlyAvailable: 'Monthly available amount', budgetCardColor: 'Card color', defaultCurrency: 'Default currency', saveBudget: 'Save budget', deleteBudget: 'Delete budget', confirmDeleteBudget: 'Delete this budget? This cannot be undone.', linkedAccount: 'Linked account', allAccounts: 'All accounts', budgetAlreadyExists: 'A budget with this category already exists.',
        addAccount: 'Add account', noAccounts: 'Add an account to start organizing your money.', createFirstAccount: 'Create your first account',
        fiveDayTrend: 'Five-day cash flow', selectedAccount: 'Selected account', accountSetupHint: 'Set a name, opening amount and currency for this account.',
        accountName: 'Account name', openingBalance: 'Opening amount', saveAccount: 'Save account', cancel: 'Cancel', close: 'Close',
        chooseAccountFirst: 'Create or select an account before adding a transaction.', activityHint: 'Review this month’s activity for the selected account.',
        comingSoon: 'This section is ready for a future update.', settingsHint: 'Choose how Mint Finance looks and reads.', languageHint: 'Select the interface language.', themeHint: 'Choose a light or dark appearance.',
        brand: 'MINT FINANCE', title: 'Personal finance, in clear view.', subtitle: 'A quiet space to understand your spending and stay close to your plans.',
        overview: 'Overview', activity: 'Activity', profile: 'Profile', month: 'Month', income: 'Income', expense: 'Spending', balance: 'Net balance',
    incomePageIntro: 'Review income by source, account and transaction.', incomeSources: 'Income sources', incomeSourcesCount: 'sources', incomeThisMonth: 'Income this month', incomeRecordCount: 'records', incomeDetails: 'income details', individualIncomeAmounts: 'Income per transaction', incomeByAccount: 'Income by account', recentIncomeRecords: 'Latest five income records', noIncomeForSource: 'No income for this source this month.', noIncomeSources: 'No income sources are available.', addIncomeSource: 'Add source', editIncomeSource: 'Edit source', sourceTitle: 'Source name', saveIncomeSource: 'Save source', incomeSourceHint: 'Change the source name. Existing income records will stay linked to this source.', incomeSourceExists: 'A source with this name already exists.',
        newTransaction: 'Add transaction', type: 'Type', category: 'Category', source: 'Source', otherSource: 'Other', salarySource: 'Salary', bonusSource: 'Bonus', amount: 'Amount', date: 'Date', note: 'Note', save: 'Save transaction',
        titleLabel: 'Title', editTransaction: 'Edit transaction', updateTransaction: 'Update transaction', transactionDetails: 'Transaction details',
        timeFormat: 'Time format', timeFormatHint: 'Choose how transaction times appear.', hourFormat12: '12-hour', hourFormat24: '24-hour',
        incomeType: 'Income', expenseType: 'Expense', recent: 'Recent activity', empty: 'No transactions for this month yet.',
        anonymous: 'Anonymous workspace', localNote: 'Your data stays in this browser until you choose to sign in.', account: 'Account',
        signIn: 'Sign in', register: 'Create account', email: 'Email address', password: 'Password', confirmPassword: 'Confirm password',
        signOut: 'Sign out', language: 'Language', theme: 'Appearance', light: 'Light', dark: 'Dark', security: 'Your account',
        secureNote: 'Use an email and a password with at least 12 characters.', already: 'Already have an account?', noAccount: 'New to Mint Finance?',
        switchLogin: 'Sign in', switchRegister: 'Create an account', authFailed: 'Could not authenticate. Check your details and try again.',
        passwordMismatch: 'Passwords do not match.', passwordShort: 'Use at least 12 characters.', migrationTitle: 'Local data found',
        migrationText: 'Choose how to continue. Merging uploads your anonymous workspace to this account.', merge: 'Merge local data', keepServer: 'Use account data',
        saved: 'Saved', saveFailed: 'Could not save your data. Check your connection and try again.', roleUser: 'Member account', roleAnonymous: 'Anonymous',
        currency: 'Currency', delete: 'Delete', fieldRequired: 'Please complete the required fields.',
        confirmDelete: 'Delete this transaction? This cannot be undone.',
        monthlyAutoAdd: 'Monthly auto-add', recurrenceTiming: 'Repeat timing', monthStart: 'Beginning of month', monthEnd: 'End of month', sameDayMonthly: 'Same day each month', customTime: 'Custom date and time', dayOfMonth: 'Day of month', recurrenceTime: 'Time', monthlyAutoAddHint: 'Creates the same transaction each month, without its photo.', confirmMonthlyAutoAdd: 'Enable monthly auto-add for this transaction? A copy will be created automatically each month.',
        username: 'Username', defaultUser: 'Default User', profileIntro: 'Your profile and account details.',
        profileEditHint: 'Personalize your local profile. It will be included when you create an account.',
        changeAvatar: 'Change avatar', avatarTypeError: 'Choose a PNG, JPEG, WEBP or GIF image under 5 MB.',
        profileLoginPrompt: 'Sign in or create an account to keep your profile available across devices.',
        loginOrRegister: 'Sign in or create an account', authModalIntro: 'Use your email to sign in or create your account.',
        addCategory: 'Add a category', categoryName: 'Category name',
        noteImage: 'Note photo', attachImage: 'Attach photo', changeImage: 'Change photo', removeImage: 'Remove photo',
        imageTypeError: 'Choose a PNG, JPEG, WEBP or GIF image under 5 MB.',
        migrationOption: 'Move local records to your account', migrationOptionHint: 'Transfer anonymous transactions and budgets to your account.',
        migrationComingSoon: 'Local record migration will be available here soon.',
        profileAccountEditHint: 'Changes are saved to your account on the server.',
        saveProfile: 'Save profile', profileSaved: 'Profile updated successfully.',
        footer: 'Personal finance, kept simple', overviewHint: 'Your monthly picture at a glance', transactionsCount: 'transactions'
    },
    zh: {
        summaryCurrency: '\u7edf\u8ba1\u5e01\u79cd', ratesLoading: '\u6c47\u7387\u52a0\u8f7d\u4e2d\u2026', ratesUnavailable: '\u6682\u65f6\u65e0\u6cd5\u83b7\u53d6\u6c47\u7387', ratesCached: '\u4f7f\u7528\u7f13\u5b58\u6c47\u7387', ratesThrough: '\u6c47\u7387\u66f4\u65b0\u81f3', refreshRates: '\u5237\u65b0\u6c47\u7387', activitySummary: '\u672c\u6708\u6536\u652f\u7edf\u8ba1',
        filterTransactions: '\u7b5b\u9009\u6536\u652f\u8bb0\u5f55', transactionType: '\u6536\u652f\u7c7b\u578b', allTransactionTypes: '\u5168\u90e8\u7c7b\u578b', filterIncomeSource: '\u6536\u5165\u6765\u6e90', allSources: '\u6240\u6709\u6765\u6e90', filterAutoAdd: '\u81ea\u52a8\u6dfb\u52a0', allRecurringTypes: '\u5168\u90e8\u8bb0\u5f55', recurringOnly: '\u4ec5\u81ea\u52a8\u6dfb\u52a0', nonRecurringOnly: '\u4ec5\u624b\u52a8\u8bb0\u5f55', dateRange: '\u65e5\u671f\u8303\u56f4', startDate: '\u5f00\u59cb\u65e5\u671f', endDate: '\u7ed3\u675f\u65e5\u671f', amountRange: '\u91d1\u989d\u8303\u56f4', minimumAmount: '\u6700\u4f4e\u91d1\u989d', maximumAmount: '\u6700\u9ad8\u91d1\u989d', filterBudget: '\u9884\u7b97', allBudgets: '\u6240\u6709\u9884\u7b97', filterAccount: '\u8d26\u6237', clearFilters: '\u6e05\u9664\u7b5b\u9009', noMatchingTransactions: '\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u6536\u652f\u8bb0\u5f55',
        home: '首页', budgets: '预算', settings: '设置', accounts: '账户', accountOverview: '账户总览',
        budgetIntro: '为各项支出设置每月额度，随时查看剩余可用金额。', monthlyBudgets: '每月预算', budgetsCount: '个预算', addBudget: '添加预算', noBudgets: '还没有预算，添加一项来设置每月支出额度。',
        remainingBudget: '剩余可用', totalBudget: '每月总额', budgetProgress: '支出进度', spentBudget: '已支出', monthEnds: '本月截止', editBudget: '编辑预算', budgetDetails: '\u9884\u7b97\u8be6\u60c5', remainingBudgetTrend: '\u672c\u6708\u5269\u4f59\u9884\u7b97', accountSpendingShare: '\u5404\u8d26\u6237\u6d88\u8d39\u5360\u6bd4', noBudgetSpending: '\u672c\u6708\u6682\u65e0\u76f8\u5173\u652f\u51fa\u3002', recentBudgetTransactions: '\u6700\u8fd1\u4e94\u7b14\u652f\u51fa', unassignedAccount: '\u672a\u6307\u5b9a\u8d26\u6237', budgetEditorHint: '设置预算名称、默认币种、每月可用金额和卡片颜色；同分类的所有账户支出都会计入预算。', budgetName: '预算名称', monthlyAvailable: '每月可用金额', budgetCardColor: '卡片颜色', defaultCurrency: '默认币种', saveBudget: '保存预算', deleteBudget: '删除预算', confirmDeleteBudget: '确定删除此预算吗？删除后无法恢复。', linkedAccount: '关联账户', allAccounts: '全部账户', budgetAlreadyExists: '该分类已存在预算。',
        addAccount: '添加账户', noAccounts: '添加账户，开始整理收支。', createFirstAccount: '创建第一个账户',
        fiveDayTrend: '近五日收支', selectedAccount: '当前账户', accountSetupHint: '为账户设置名称、初始金额和币种。',
        accountName: '账户名称', openingBalance: '初始金额', saveAccount: '保存账户', cancel: '取消', close: '关闭',
        chooseAccountFirst: '请先创建或选择账户，再添加交易。', activityHint: '查看当前账户本月收支记录。',
        comingSoon: '此页面将在后续版本开放。', settingsHint: '设置 Mint Finance 的显示方式。', languageHint: '选择界面语言。', themeHint: '选择浅色或深色外观。',
        brand: 'MINT FINANCE', title: '收支清晰，心里有数。', subtitle: '用一处安静、简单的空间，了解日常支出并照顾好计划。',
        overview: '概览', activity: '收支记录', profile: '个人资料', month: '月份', income: '收入', expense: '支出', balance: '收支结余',
    incomePageIntro: '\u6309\u6765\u6e90\u3001\u8d26\u6237\u548c\u5355\u7b14\u8bb0\u5f55\u67e5\u770b\u6536\u5165\u3002', incomeSources: '\u6536\u5165\u6765\u6e90', incomeSourcesCount: '\u4e2a\u6765\u6e90', incomeThisMonth: '\u672c\u6708\u6536\u5165', incomeRecordCount: '\u7b14\u8bb0\u5f55', incomeDetails: '\u6536\u5165\u8be6\u60c5', individualIncomeAmounts: '\u5355\u7b14\u6536\u5165\u91d1\u989d', incomeByAccount: '\u5404\u8d26\u6237\u6536\u5165', recentIncomeRecords: '\u6700\u8fd1\u4e94\u7b14\u6536\u5165', noIncomeForSource: '\u672c\u6708\u8be5\u6765\u6e90\u6682\u65e0\u6536\u5165\u8bb0\u5f55\u3002', noIncomeSources: '\u6682\u65e0\u6536\u5165\u6765\u6e90\u3002', addIncomeSource: '\u6dfb\u52a0\u6765\u6e90', editIncomeSource: '\u7f16\u8f91\u6765\u6e90', sourceTitle: '\u6765\u6e90\u540d\u79f0', saveIncomeSource: '\u4fdd\u5b58\u6765\u6e90', incomeSourceHint: '\u4fee\u6539\u6765\u6e90\u540d\u79f0\u540e\uff0c\u73b0\u6709\u6536\u5165\u8bb0\u5f55\u4ecd\u4f1a\u5173\u8054\u6b64\u6765\u6e90\u3002', incomeSourceExists: '\u5df2\u5b58\u5728\u540c\u540d\u6536\u5165\u6765\u6e90\u3002',
        newTransaction: '添加一笔收支', type: '类型', category: '分类', source: '\u6765\u6e90', otherSource: '\u5176\u4ed6', salarySource: '\u5de5\u8d44', bonusSource: '\u5956\u91d1', amount: '金额', date: '日期', note: '备注', save: '保存记录',
        titleLabel: '\u6807\u9898', editTransaction: '\u7f16\u8f91\u4ea4\u6613', updateTransaction: '\u66f4\u65b0\u8bb0\u5f55', transactionDetails: '\u4ea4\u6613\u8be6\u60c5',
        timeFormat: '\u65f6\u95f4\u683c\u5f0f', timeFormatHint: '\u9009\u62e9\u4ea4\u6613\u65f6\u95f4\u7684\u663e\u793a\u65b9\u5f0f\u3002', hourFormat12: '12\u5c0f\u65f6\u5236', hourFormat24: '24\u5c0f\u65f6\u5236',
        incomeType: '收入', expenseType: '支出', recent: '最近记录', empty: '本月还没有收支记录。',
        anonymous: '匿名空间', localNote: '登录前，数据只保存在当前浏览器中。', account: '账户',
        signIn: '登录', register: '创建账户', email: '邮箱地址', password: '密码', confirmPassword: '再次输入密码',
        signOut: '退出登录', language: '语言', theme: '外观', light: '浅色', dark: '深色', security: '账户设置',
        secureNote: '使用邮箱注册，密码至少 12 个字符。', already: '已经有账户？', noAccount: '第一次使用？',
        switchLogin: '去登录', switchRegister: '创建账户', authFailed: '验证失败，请检查邮箱和密码后重试。',
        passwordMismatch: '两次输入的密码不一致。', passwordShort: '密码至少需要 12 个字符。', migrationTitle: '发现本地数据',
        migrationText: '选择继续方式。合并会将匿名空间的数据上传到当前账户。', merge: '合并本地数据', keepServer: '使用账户数据',
        saved: '已保存', saveFailed: '数据保存失败，请检查网络后重试。', roleUser: '已登录账户', roleAnonymous: '匿名使用',
        currency: '币种', delete: '删除', fieldRequired: '请填写必填项目。',
        confirmDelete: '\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u4ea4\u6613\u5417\uff1f\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002',
        monthlyAutoAdd: '\u6bcf\u6708\u81ea\u52a8\u6dfb\u52a0', recurrenceTiming: '\u6dfb\u52a0\u65f6\u95f4', monthStart: '\u6bcf\u6708\u6708\u521d', monthEnd: '\u6bcf\u6708\u6708\u672b', sameDayMonthly: '\u6bcf\u6708\u7684\u4eca\u5929', customTime: '\u81ea\u5b9a\u4e49\u65e5\u671f\u548c\u65f6\u95f4', dayOfMonth: '\u6bcf\u6708\u51e0\u53f7', recurrenceTime: '\u65f6\u95f4', monthlyAutoAddHint: '\u6bcf\u6708\u81ea\u52a8\u521b\u5efa\u540c\u6837\u7684\u6536\u652f\u8bb0\u5f55\uff0c\u4e0d\u5305\u542b\u56fe\u7247\u3002', confirmMonthlyAutoAdd: '\u786e\u8ba4\u4e3a\u8fd9\u7b14\u6536\u652f\u542f\u7528\u6bcf\u6708\u81ea\u52a8\u6dfb\u52a0\u5417\uff1f\u4e4b\u540e\u4f1a\u6bcf\u6708\u81ea\u52a8\u521b\u5efa\u4e00\u6761\u8bb0\u5f55\u3002',
        username: '\u7528\u6237\u540d', defaultUser: 'Default User', profileIntro: '\u4e2a\u4eba\u8d44\u6599\u4e0e\u8d26\u6237\u4fe1\u606f',
        profileEditHint: '\u4e2a\u6027\u5316\u672c\u5730\u8d44\u6599\uff1b\u521b\u5efa\u8d26\u6237\u65f6\u4f1a\u4e00\u5e76\u4fdd\u5b58\u3002',
        changeAvatar: '\u66f4\u6362\u5934\u50cf', avatarTypeError: '\u8bf7\u9009\u62e9 5 MB \u4ee5\u5185\u7684 PNG\u3001JPEG\u3001WEBP \u6216 GIF \u56fe\u7247\u3002',
        profileLoginPrompt: '\u767b\u5f55\u6216\u521b\u5efa\u8d26\u6237\uff0c\u53ef\u5728\u591a\u53f0\u8bbe\u5907\u4e0a\u4f7f\u7528\u4e2a\u4eba\u8d44\u6599\u3002',
        loginOrRegister: '\u767b\u5f55\u6216\u521b\u5efa\u8d26\u6237', authModalIntro: '\u4f7f\u7528\u90ae\u7bb1\u767b\u5f55\u6216\u521b\u5efa\u8d26\u6237\u3002',
        addCategory: '\u6dfb\u52a0\u5206\u7c7b', categoryName: '\u5206\u7c7b\u540d\u79f0',
        noteImage: '\u5907\u6ce8\u56fe\u7247', attachImage: '\u4e0a\u4f20\u56fe\u7247', changeImage: '\u66f4\u6362\u56fe\u7247', removeImage: '\u79fb\u9664\u56fe\u7247',
        imageTypeError: '\u8bf7\u9009\u62e9 5 MB \u4ee5\u5185\u7684 PNG\u3001JPEG\u3001WEBP \u6216 GIF \u56fe\u7247\u3002',
        migrationOption: '\u5c06\u672c\u5730\u8bb0\u5f55\u8fc1\u79fb\u5230\u8d26\u6237', migrationOptionHint: '\u5c06\u533f\u540d\u4ea4\u6613\u548c\u9884\u7b97\u8f6c\u79fb\u5230\u8d26\u6237\u3002',
        migrationComingSoon: '\u672c\u5730\u8bb0\u5f55\u8fc1\u79fb\u529f\u80fd\u5c06\u5728\u6b64\u5904\u63d0\u4f9b\u3002',
        profileAccountEditHint: '\u4fee\u6539\u4f1a\u4fdd\u5b58\u5230\u670d\u52a1\u5668\u8d26\u6237\u3002',
        saveProfile: '\u4fdd\u5b58\u8d44\u6599', profileSaved: '\u4e2a\u4eba\u8d44\u6599\u5df2\u66f4\u65b0\u3002',
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
